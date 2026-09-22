"use client";

import ConnectWalletButton from "@/components/ConnectWalletButton";
import Link from "next/link";
import { useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import { ToastStack } from "@/components/Toasts";
import AppNav from "@/components/AppNav";
import { useVaultData } from "@/hooks/useVaultData";
import { deriveAddresses, toUiAmount } from "../../../vault";
import { LB_PAIR_ADDRESS } from "../../../config";
import { VaultEvent } from "../../../history";

/**
 * Activity: history, protocol internals, and the wider ecosystem.
 * Read-only — nothing here moves funds.
 */
export default function ActivityPage() {
  const {
    connected,
    publicKey,
    pool,
    balances,
    rate,
    history,
    toasts,
    dismiss,
    providerState,
  } = useVaultData();
  const [showAdvanced, setShowAdvanced] = useState(false);

  let advanced: ReturnType<typeof deriveAddresses> | null = null;
  try {
    advanced = deriveAddresses();
  } catch {
    advanced = null;
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
      <h1>Your trail, on-chain.</h1>

      {!connected ? (
        <>
          <p className="muted">Connect Phantom to see your transaction history and protocol details.</p>
          <p className="fine">{providerState}.</p>
        </>
      ) : (
        <div>
          <p>
            <span className="dot" /> {shortKey(publicKey?.toBase58() ?? "")} · Phantom
          </p>

          <AppNav />

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
      <ToastStack toasts={toasts} onDismiss={dismiss} />
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

function HistoryTimeline({ events }: { events: VaultEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="card" style={{ marginTop: "1rem" }}>
        <span className="label">Transaction history</span>
        <p className="muted">No vault transactions yet — they will appear here with explorer links.</p>
      </div>
    );
  }
  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <span className="label">Transaction history</span>
      <ul className="timeline">
        {events.map((e) => (
          <li key={e.signature}>
            <strong>{e.kind === "deposit" ? "Vaulted" : "Unvaulted"}</strong>{" "}
            <span className="muted">{e.tslax.toFixed(6)} TSLAx</span>{" "}
            <a
              className="fine"
              href={`https://explorer.solana.com/tx/${e.signature}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              {e.time ? new Date(e.time * 1000).toLocaleString() : `slot ${e.slot}`}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function shortKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 4)}...${key.slice(-4)}` : key;
}
