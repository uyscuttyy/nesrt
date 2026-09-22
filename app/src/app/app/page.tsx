"use client";

import { useAnchorWallet } from "@solana/wallet-adapter-react";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TSLAX_MINT } from "../../config";
import { friendlyError } from "../../errors";
import { recordFlow } from "../../flows";
import { buildDepositTx, buildWithdrawTx, toBaseUnits, toUiAmount } from "../../vault";
import ThemeToggle from "@/components/ThemeToggle";
import { ToastStack } from "@/components/Toasts";
import OnboardingModal from "@/components/OnboardingModal";
import JupiterZapModal from "@/components/JupiterZapModal";
import AppNav from "@/components/AppNav";
import { useVaultData } from "@/hooks/useVaultData";

/**
 * Vault: put capital to work and take it out. Nothing else lives here —
 * earnings live on /app/earn, history and protocol details on /app/activity.
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
  const [tab, setTab] = useState<"vault" | "unvault" | "zap">("vault");
  const [busy, setBusy] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

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
        (/blockhash|expired|timeout|429|rate.?limit|simulation failed|failed to fetch/i.test(msg));
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
    const rate = pool?.rate ?? null;
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
      const sig = await sendTransaction(
        tx,
        connection,
        extraSigners.length > 0 ? { signers: extraSigners } : undefined
      );
      return { sig };
    }, "withdraw");
  }

  function useMax() {
    if (tab === "vault") {
      if (balances.tslax !== null) setAmount(toUiAmount(balances.tslax).toString());
    } else if (positionValue !== null) {
      setAmount(positionValue.toString());
    }
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
    <main className="wrap sanctuary">
      <header className="nav">
        <Link className="brand" href="/">
          Nesrt Vault
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <ThemeToggle />
          <ConnectWalletButton />
        </div>
      </header>

      <p className="eyebrow">Nesrt Vault · Solana Devnet</p>
      <h1>Put your on-chain stocks to work.</h1>

      {!connected ? (
        <>
          <p className="muted">Connect Phantom to vault TSLAx and earn lending yield. No numbers to manage.</p>
          <p className="fine">{providerState}.</p>
        </>
      ) : (
        <div>
          <div className="account-bar">
            <span>
              <span className="dot" /> Connected {shortKey(publicKey?.toBase58() ?? "")} · Phantom
            </span>
            <button className="ghost ghost-sm" onClick={() => void onFaucet()} disabled={busy}>
              {busy ? "Working…" : "Get 100 test TSLAx"}
            </button>
          </div>

          <AppNav />

          <div className="cards">
            <div className="card">
              <span className="label">Wallet TSLAx</span>
              <strong>{fmt(balances.tslax)}</strong>
            </div>
            <div className="card accent-card">
              <span className="label">Vaulted TSLAx</span>
              <strong>{positionValue === null ? "—" : `${positionValue.toFixed(6)} TSLAx`}</strong>
              <span className="fine">
                Working in the lending pool. Withdraw anytime.
                {balances.ntsla !== null && balances.ntsla > 0n
                  ? ` Wallet holds ${toUiAmount(balances.ntsla).toFixed(2)} nTSLA (nTSLA moved to Meteora no longer counts here).`
                  : ""}
              </span>
            </div>
          </div>

          <div className="card action-card">
            <div className="tabs" role="tablist">
              {(
                [
                  ["vault", "Vault"],
                  ["unvault", "Unvault"],
                  ["zap", "Zap ⚡"],
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
                <JupiterZapModal onDone={() => void refreshAll()} />
              </div>
            ) : (
              <>
                <div className="actions">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="any"
                    placeholder={tab === "vault" ? "Amount of TSLAx to Vault" : "Amount to unvault, empty for full"}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={busy}
                    style={{ fontSize: "1.15rem", fontWeight: 600 }}
                  />
                  <button className="ghost" onClick={useMax} disabled={busy}>
                    Max
                  </button>
                </div>
                {tab === "vault" ? (
                  <div className="actions">
                    <button className="cta" onClick={onPutToWork} disabled={busy}>
                      {busy ? "Working…" : "Put Capital to Work"}
                    </button>
                  </div>
                ) : (
                  <div className="actions">
                    <button className="cta" onClick={() => onUnvault(false)} disabled={busy}>
                      {busy ? "Working…" : "Unvault Capital"}
                    </button>
                    <button className="ghost" onClick={() => onUnvault(true)} disabled={busy}>
                      Unvault All
                    </button>
                  </div>
                )}
                <p className="fine">One click. No pools, rates, or LTVs to manage.</p>
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
    </main>
  );
}

function fmt(v: bigint | null): string {
  return v === null ? "—" : `${toUiAmount(v).toFixed(6)} TSLAx`;
}

function shortKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 4)}...${key.slice(-4)}` : key;
}
