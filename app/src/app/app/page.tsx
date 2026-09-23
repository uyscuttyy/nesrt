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
import HistoryTimeline from "@/components/HistoryTimeline";
import JupiterZapModal from "@/components/JupiterZapModal";
import { useVaultData } from "@/hooks/useVaultData";

type ActionTab = "vault" | "unvault" | "zap";

/**
 * Vault: two metrics, one action card, recent history. Modals handle
 * interaction; backdrop click or Escape dismisses.
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
    history,
    toasts,
    push,
    dismiss,
    providerState,
  } = useVaultData();
  const anchorWallet = useAnchorWallet();
  const [amount, setAmount] = useState("");
  const [tab, setTab] = useState<ActionTab>("vault");
  const [modal, setModal] = useState<ActionTab | null>(null);
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

  // Escape dismisses the action modal.
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);

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
      setModal(null);
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
    if (balances.tslax !== null) setAmount(toUiAmount(balances.tslax).toString());
  }

  function useMaxPosition() {
    if (positionValue !== null) setAmount(positionValue.toString());
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

  const summaries: Record<ActionTab, { title: string; body: string; cta: string }> = {
    vault: {
      title: "Vault TSLAx",
      body:
        rate !== null
          ? `1 TSLAx → ~${rate.toFixed(4)} nTSLA at the live rate. Receipts stay liquid.`
          : "Deposit TSLAx, receive liquid nTSLA receipt tokens.",
      cta: "Vault TSLAx",
    },
    unvault: {
      title: "Unvault nTSLA",
      body:
        positionValue !== null
          ? `${positionValue.toFixed(2)} TSLAx working. Burn nTSLA for principal plus yield.`
          : "No position yet — vault first.",
      cta: "Unvault nTSLA",
    },
    zap: {
      title: "Zap in 1-Click",
      body: "Start from SOL or USDC. Swap and vault in one flow, no manual routing.",
      cta: "Zap in 1-Click",
    },
  };

  return (
    <main>
      <Navbar />
      <div className="wrap sanctuary">
        <p className="eyebrow">Vault</p>
        <h1>Vault</h1>
        <p className="muted">Deposit to earn, unvault anytime. One action at a time.</p>

        {!connected ? (
          <>
            <p className="muted">Connect Phantom to begin. {providerState}.</p>
            <div className="actions">
              <button className="ghost ghost-sm" onClick={() => void onFaucet()} disabled>
                Get 100 test TSLAx
              </button>
            </div>
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

            <div className="card action-card">
              <div className="tabs" role="tablist">
                {(
                  [
                    ["vault", "Vault"],
                    ["unvault", "Unvault"],
                    ["zap", "Zap ⚡️"],
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
              <h3 className="action-modal-title">{summaries[tab].title}</h3>
              <p className="muted">{summaries[tab].body}</p>
              <div className="actions">
                <button
                  className="cta"
                  onClick={() => setModal(tab)}
                  disabled={busy || (tab === "unvault" && (balances.ntsla === null || balances.ntsla === 0n))}
                >
                  {summaries[tab].cta}
                </button>
              </div>
            </div>

            <HistoryTimeline events={history} compact />
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
        {modal && connected ? (
          <div
            className="modal-backdrop"
            onClick={() => {
              if (!busy) {
                setModal(null);
                setAmount("");
              }
            }}
          >
            <div
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-label={summaries[modal].title}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="action-modal-title">{summaries[modal].title}</h2>
              {modal === "zap" ? (
                <ZapModalBody
                  onDone={() => {
                    setModal(null);
                    setAmount("");
                    void refresh();
                    void refreshHistory();
                  }}
                />
              ) : (
                <>
                  <p className="muted action-modal-sub">
                    {modal === "vault"
                      ? "Amount of TSLAx to vault. Receipts arrive as nTSLA."
                      : "Amount to unvault. Empty means the full position."}
                  </p>
                  <div className="actions">
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="any"
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder={modal === "vault" ? "Amount of TSLAx" : "Amount, empty for full"}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      disabled={busy}
                      style={{ fontSize: "1.15rem", fontWeight: 600 }}
                      autoFocus
                    />
                    <button
                      className="ghost"
                      onClick={() => (modal === "vault" ? useMax() : useMaxPosition())}
                      disabled={busy}
                    >
                      Max
                    </button>
                  </div>
                  <div className="actions">
                    <button
                      className="cta"
                      onClick={() => (modal === "vault" ? onPutToWork() : onUnvault(amount.trim() === ""))}
                      disabled={busy}
                    >
                      {busy ? "Working…" : `Confirm ${summaries[modal].cta}`}
                    </button>
                    <button className="ghost" onClick={() => setModal(null)} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
        <ToastStack toasts={toasts} onDismiss={dismiss} />
      </div>
    </main>
  );
}

function ZapModalBody({ onDone }: { onDone: () => void }) {
  return <JupiterZapModal onDone={onDone} />;
}

function fmt(v: bigint | null): string {
  return v === null ? "—" : `${toUiAmount(v).toFixed(6)} TSLAx`;
}

function shortKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 4)}...${key.slice(-4)}` : key;
}
