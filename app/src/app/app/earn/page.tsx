"use client";

import ConnectWalletButton from "@/components/ConnectWalletButton";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import { ToastStack } from "@/components/Toasts";
import YieldChart from "@/components/YieldChart";
import AppNav from "@/components/AppNav";
import { useVaultData } from "@/hooks/useVaultData";
import { toUiAmount } from "../../../vault";

/**
 * Earn: everything about growth. Pool yield, profit trajectory, treasury.
 * No actions here — acting lives on /app (Vault).
 */
export default function EarnPage() {
  const {
    connected,
    publicKey,
    balances,
    pool,
    apy,
    positionValue,
    totalValue,
    profit,
    toasts,
    dismiss,
    providerState,
  } = useVaultData();

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
      <h1>Watch it grow.</h1>

      {!connected ? (
        <>
          <p className="muted">Connect Phantom to see your earnings. Nothing moves until you vault.</p>
          <p className="fine">{providerState}.</p>
        </>
      ) : (
        <div>
          <p>
            <span className="dot" /> {shortKey(publicKey?.toBase58() ?? "")} · Phantom
          </p>

          <AppNav />

          <div className="cards">
            <div className="card accent-card">
              <span className="label">Total Value</span>
              <strong>{totalValue === null ? "—" : `${totalValue.toFixed(6)} TSLAx`}</strong>
              <span className="fine">Wallet + vaulted, live.</span>
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
              <span className="label">Vaulted TSLAx</span>
              <strong>{positionValue === null ? "—" : `${positionValue.toFixed(6)} TSLAx`}</strong>
              <span className="fine">
                {balances.ntsla !== null
                  ? `${toUiAmount(balances.ntsla).toFixed(2)} nTSLA working`
                  : "Nothing vaulted yet."}
              </span>
            </div>
          </div>

          <YieldChart profit={profit} />

          <div className="card" style={{ marginTop: "1rem" }}>
            <span className="label">How yield works</span>
            <p className="muted">
              Borrow interest is dripped into the pool, raising the price of every share.
              Your nTSLA is worth more TSLAx over time. On withdraw, 10% of the yield
              funds the protocol treasury — principal is never touched.
            </p>
            <p className="fine">
              <Link href="/app">Back to Vault →</Link>
            </p>
          </div>
        </div>
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </main>
  );
}

function shortKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 4)}...${key.slice(-4)}` : key;
}
