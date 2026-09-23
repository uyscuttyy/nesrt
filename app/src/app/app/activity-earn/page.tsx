"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import { ToastStack } from "@/components/Toasts";
import YieldChart from "@/components/YieldChart";
import HistoryTimeline from "@/components/HistoryTimeline";
import AppNav from "@/components/AppNav";
import { useVaultData } from "@/hooks/useVaultData";
import { deriveAddresses, toUiAmount } from "../../../vault";
import { LB_PAIR_ADDRESS } from "../../../config";

/**
 * Activity & Earn: one page, two tabs. Earn Overview shows growth;
 * On-Chain Activity shows the trail. Read-only throughout.
 */
export default function ActivityEarnPage() {
  const {
    connected,
    publicKey,
    balances,
    pool,
    rate,
    apy,
    totalValue,
    profit,
    history,
    toasts,
    dismiss,
    providerState,
  } = useVaultData();
  const [tab, setTab] = useState<"earn" | "activity">("earn");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Deep-link support for legacy /app/earn and /app/activity redirects.
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "activity" || t === "earn") setTab(t);
    } catch {
      /* ignore */
    }
  }, []);

  let advanced: ReturnType<typeof deriveAddresses> | null = null;
  try {
    advanced = deriveAddresses();
  } catch {
    advanced = null;
  }

  return (
    <main>
      <Navbar />
      <div className="wrap sanctuary">
        <p className="eyebrow">Activity &amp; Earn</p>
        <h1>Growth and trail.</h1>
        <p className="muted">Earnings on the left tab, evidence on the right. Nothing here moves funds.</p>

        {!connected ? (
          <p className="muted">Connect Phantom to continue. {providerState}.</p>
        ) : (
          <div>
            <p>
              <span className="dot" /> {shortKey(publicKey?.toBase58() ?? "")} · Phantom
            </p>

            <AppNav />

            <div className="tabs" role="tablist" style={{ marginTop: "1.5rem" }}>
              {(
                [
                  ["earn", "Earn Overview"],
                  ["activity", "On-Chain Activity"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  className={tab === key ? "tab tab-active" : "tab"}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "earn" ? (
              <div className="tab-pane" style={{ marginTop: "1rem" }}>
                <div className="cards">
                  <div className="card accent-card">
                    <span className="label">Total Value Locked</span>
                    <strong>{totalValue === null ? "—" : `${totalValue.toFixed(6)} TSLAx`}</strong>
                    <span className="fine">Your wallet + vaulted position.</span>
                  </div>
                  <div className="card">
                    <span className="label">Profit earned</span>
                    <strong>
                      {profit === null ? "—" : `${profit >= 0 ? "+" : ""}${profit.toFixed(6)} TSLAx`}
                    </strong>
                    <span className="fine">Position + withdrawn − deposited. Deposits never count.</span>
                  </div>
                  <div className="card">
                    <span className="label">Pool yield</span>
                    <strong>{apy === null ? "—" : `${apy.toFixed(2)}%`}</strong>
                    <span className="fine">
                      {pool
                        ? `live: ${toUiAmount(pool.yieldAccruedBase).toFixed(6)} ÷ ${toUiAmount(pool.totalDepositsBase).toFixed(2)} accrued/deposited`
                        : "live from pool"}
                    </span>
                  </div>
                  <div className="card">
                    <span className="label">Treasury cut</span>
                    <strong>10% of yield</strong>
                    <span className="fine">Skimmed on withdraw. Principal never touched.</span>
                  </div>
                </div>

                <YieldChart profit={profit} />

                <div className="card" style={{ marginTop: "1rem" }}>
                  <span className="label">How yield works</span>
                  <p className="muted">
                    Borrow interest is dripped into the pool, raising the price of every
                    share — 1 nTSLA redeems for more TSLAx over time. The pool&apos;s
                    exchange rate is {rate === null ? "loading" : `${rate.toFixed(6)} TSLAx per nTSLA`}.
                  </p>
                  <p className="fine">
                    <Link href="/app">Back to Vault →</Link>
                  </p>
                </div>
              </div>
            ) : (
              <div className="tab-pane" style={{ marginTop: "1rem" }}>
                <TradeCard />
                <HistoryTimeline events={history} />

                <div className="card" style={{ marginTop: "1rem" }}>
                  <button className="ghost" onClick={() => setShowAdvanced((v) => !v)}>
                    {showAdvanced ? "Hide Advanced Protocol Details" : "Show Advanced Protocol Details"}
                  </button>
                  {showAdvanced ? (
                    <div className="mono" style={{ marginTop: "1rem", display: "grid", gap: "0.5rem" }}>
                      <div>Exchange rate: {rate === null ? "—" : rate.toFixed(6)} TSLAx per nTSLA</div>
                      <div>nTSLA balance: {balances.ntsla === null ? "—" : toUiAmount(balances.ntsla).toFixed(6)}</div>
                      <div>Pool deposits: {pool ? toUiAmount(pool.totalDepositsBase).toFixed(6) : "—"} TSLAx</div>
                      <div>Pool shares: {pool ? toUiAmount(pool.totalSharesBase).toFixed(6) : "—"}</div>
                      <div>Pool yield accrued: {pool ? toUiAmount(pool.yieldAccruedBase).toFixed(6) : "—"} TSLAx</div>
                      {advanced ? (
                        <>
                          <div>Vault state: {advanced.vaultState.toBase58()}</div>
                          <div>Vault authority: {advanced.authority.toBase58()}</div>
                          <div>Receipt mint: {advanced.receiptMint.toBase58()}</div>
                          <div>Mock pool: {advanced.mockPool.toBase58()}</div>
                          <div>Shares mint: {advanced.sharesMint.toBase58()}</div>
                        </>
                      ) : null}
                      <div>
                        <Link href="/app/pool">Liquidity pool creator →</Link>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}
        <ToastStack toasts={toasts} onDismiss={dismiss} />
      </div>
    </main>
  );
}

function TradeCard() {
  if (!LB_PAIR_ADDRESS) return null;
  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <span className="label">Trade nTSLA</span>
      <strong className="mono" style={{ fontSize: "1rem" }}>
        nTSLA/USDC · 0.25% fee
      </strong>
      <span className="fine">Live DLMM pool on devnet. Swap without unvaulting.</span>
      <span className="fine">Unverified tokens: Meteora may not load metadata or prices — the pool still works.</span>
      <div className="actions">
        <a
          className="cta"
          style={{ textDecoration: "none" }}
          href={`https://devnet.meteora.ag/dlmm/${LB_PAIR_ADDRESS}`}
          target="_blank"
          rel="noreferrer"
        >
          Trade on Meteora
        </a>
        <a
          className="ghost"
          style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          href={`https://explorer.solana.com/address/${LB_PAIR_ADDRESS}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
        >
          View pool
        </a>
      </div>
    </div>
  );
}

function shortKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 4)}...${key.slice(-4)}` : key;
}
