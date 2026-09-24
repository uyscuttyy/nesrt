"use client";

import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { TSLAX_MINT } from "../../config";
import { friendlyError } from "../../errors";
import { recordFlow } from "../../flows";
import { buildDepositTx, buildWithdrawTx, toBaseUnits, toUiAmount } from "../../vault";
import Navbar from "@/components/Navbar";
import { ToastStack } from "@/components/Toasts";
import OnboardingModal from "@/components/OnboardingModal";
import JupiterZapModal from "@/components/JupiterZapModal";
import { useVaultData } from "@/hooks/useVaultData";

type ActionTab = "vault" | "unvault" | "zap";

/**
 * NESRT Vault: two metrics, one centered action card with inline forms.
 * Tagline left, faucet right, no account bar. History lives on Activity.
 */
export default function VaultPage() {
  const {
    connection,
    connected,
    publicKey,
    sendTransaction,
    balances,
    pool,
    positionValue,
    refresh,
    refreshHistory,
    toasts,
    push,
    dismiss,
    providerState,
  } = useVaultData();
  const anchorWallet = useAnchorWallet();
  const [amount, setAmount] = useState("");
  const [tab, setTab] = useState<ActionTab>("vault");
  const [busy, setBusy] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const rate = pool?.rate ?? null;

  useEffect(() => {
    if (!connected || !publicKey) return;
    try {
      if (!localStorage.getItem(`nesrt-onboarded-${publicKey.toBase58()}`)) setShowOnboarding(true);
    } catch {
      setShowOnboarding(true);
    }
  }, [connected, publicKey]);

  function closeOnboarding() {
    try {
      if (publicKey) localStorage.setItem(`nesrt-onboarded-${publicKey.toBase58()}`, "1");
    } catch {
      /* ignore */
    }
    setShowOnboarding(false);
  }

  async function submit(
    build: () => Promise<{ sig: string }>,
    flow?: "deposit" | "withdraw",
    retries = 1
  ) {
    const before = balances.tslax;
    setBusy(true);
    try {
      const { sig } = await build();
      await connection.confirmTransaction(sig, "confirmed");
      setAmount("");
      await refresh();
      await refreshHistory();
      if (flow && publicKey && before !== null) {
        try {
          const afterAcc = await connection.getTokenAccountBalance(
            getAssociatedTokenAddressSync(new PublicKey(TSLAX_MINT), publicKey)
          );
          const after = BigInt(afterAcc.value.amount);
          if (flow === "deposit" && after < before) {
            recordFlow(publicKey.toBase58(), "in", before - after);
          } else if (flow === "withdraw" && after > before) {
            recordFlow(publicKey.toBase58(), "out", after - before);
          }
        } catch {
          /* balance read failed — profit falls back gracefully */
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const transient =
        retries > 0 &&
        !/confirm/i.test(msg) &&
        (/blockhash|expired|timeout|429|rate.?limit|simulation failed|failed to fetch|not found|stale/i.test(msg));
      if (transient) {
        await new Promise((r) => setTimeout(r, 1200));
        setBusy(false);
        return submit(build, flow, retries - 1);
      }
      push(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  function onPutToWork() {
    if (!publicKey || !anchorWallet) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      push("Enter an amount greater than zero.");
      return;
    }
    void submit(async () => {
      const { tx, extraSigners } = await buildDepositTx(
        connection,
        publicKey,
        toBaseUnits(parsed)
      );
      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const sig = await sendTransaction(
        tx,
        connection,
        extraSigners.length > 0 ? { signers: extraSigners } : undefined
      );
      return { sig };
    }, "deposit");
  }

  function onUnvault(full: boolean) {
    if (!publicKey || !anchorWallet) return;
    if (balances.ntsla === null || balances.ntsla === 0n) {
      push("No vault position to unvault.");
      return;
    }
    let shares = balances.ntsla;
    if (!full) {
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        push("Enter an amount greater than zero.");
        return;
      }
      if (rate === null || rate <= 0) {
        push("Live rate is unavailable. Try again in a moment.");
        return;
      }
      const wanted = BigInt(Math.floor((parsed * 10 ** 6) / rate));
      if (wanted <= 0n) {
        push("That amount is too small to unvault.");
        return;
      }
      if (wanted > balances.ntsla) {
        push("That amount is more than your vault position.");
        return;
      }
      shares = wanted;
    }
    const finalShares = shares;
    void submit(async () => {
      const { tx, extraSigners } = await buildWithdrawTx(
        connection,
        publicKey,
        finalShares
      );
      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const sig = await sendTransaction(
        tx,
        connection,
        extraSigners.length > 0 ? { signers: extraSigners } : undefined
      );
      return { sig };
    }, "withdraw");
  }

  function useMax() {
    if (balances.tslax !== null) setAmount(toUiAmount(balances.tslax).toString());
  }

  function useMaxPosition() {
    if (positionValue !== null) setAmount(positionValue.toString());
  }

  async function refreshAll() {
    await refresh();
    await refreshHistory();
  }

  async function onFaucet() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: publicKey.toBase58() }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "TSLAx faucet failed.");
      push("100 test TSLAx minted to your wallet.");
      await refresh();
    } catch (e) {
      push(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <Navbar />
      <div className="wrap sanctuary">
        <p className="eyebrow eyebrow-centered">Nesrt Vault · Solana Devnet</p>
        <div className="tagline-row">
          <p className="tagline-boldo tagline">Put your on chain stocks to work while you rest</p>
          {connected ? (
            <button className="ghost ghost-sm" onClick={() => void onFaucet()} disabled={busy}>
              {busy ? "Working…" : "mint test tslax"}
            </button>
          ) : null}
        </div>

        {!connected ? (
          <p className="muted">Connect Phantom to begin. {providerState}.</p>
        ) : (
          <div>
            <div className="metric-duo">
              <div className="card">
                <span className="label">Wallet TSLAx Balance</span>
                <strong>{fmt(balances.tslax)}</strong>
              </div>
              <div className="card accent-card">
                <span className="label">Vaulted nTSLA / Vault Balance</span>
                <strong>
                  {balances.ntsla === null
                    ? "—"
                    : `${toUiAmount(balances.ntsla).toFixed(4)} nTSLA`}
                </strong>
                <span className="fine">
                  {positionValue === null ? "Nothing vaulted yet." : `≈ ${positionValue.toFixed(4)} TSLAx`}
                </span>
              </div>
            </div>

            <div className="card action-card action-centered">
              <div className="tabs tabs-centered" role="tablist">
                {(
                  [
                    ["vault", "Vault"],
                    ["unvault", "Unvault"],
                    ["zap", "Zap"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
                    className={tab === key ? "tab tab-active" : "tab"}
                    onClick={() => setTab(key)}
                    disabled={busy}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === "zap" ? (
                <div className="tab-pane">
                  <p className="muted" style={{ textAlign: "center" }}>
                    Start from SOL or USDC. Swap and vault in one flow, no manual routing.
                  </p>
                  <JupiterZapModal onDone={() => void refreshAll()} />
                </div>
              ) : (
                <>
                  <p className="muted" style={{ textAlign: "center" }}>
                    {tab === "vault"
                      ? "Amount of TSLAx to vault. Receipts arrive as nTSLA."
                      : "Amount to unvault. Empty means the full position."}
                  </p>
                  <div className="actions actions-centered">
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="any"
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder={tab === "vault" ? "Amount of TSLAx" : "Amount, empty for full"}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      disabled={busy}
                      style={{ fontSize: "1.15rem", fontWeight: 600 }}
                    />
                    <button
                      className="ghost"
                      onClick={() => (tab === "vault" ? useMax() : useMaxPosition())}
                      disabled={busy}
                    >
                      Max
                    </button>
                  </div>
                  <div className="actions actions-centered">
                    {tab === "vault" ? (
                      <button className="cta" onClick={onPutToWork} disabled={busy}>
                        {busy ? "Working…" : "Vault TSLAx"}
                      </button>
                    ) : (
                      <>
                        <button className="cta" onClick={() => onUnvault(false)} disabled={busy}>
                          {busy ? "Working…" : "Unvault nTSLA"}
                        </button>
                        <button className="ghost" onClick={() => onUnvault(true)} disabled={busy}>
                          Unvault All
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

          </div>
        )}
        {showOnboarding && connected ? (
          <OnboardingModal
            onFunded={() => {
              void refresh();
              void refreshHistory();
            }}
            onClose={closeOnboarding}
          />
        ) : null}
        <ToastStack toasts={toasts} onDismiss={dismiss} />
      </div>
    </main>
  );
}

function fmt(v: bigint | null): string {
  return v === null ? "—" : `${toUiAmount(v).toFixed(6)} TSLAx`;
}
