"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Sanctuary dashboard.
 * Phase 7: wallet connection + provider environment detection.
 * Deposit/withdraw wiring arrives in Phase 8, live yield in Phase 9.
 */
export default function Dashboard() {
  const { connected, publicKey } = useWallet();
  const [providerState, setProviderState] = useState("checking");

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w.solana || w.phantom) setProviderState("solana provider detected");
    else setProviderState("no Solana provider detected in this browser");
  }, []);

  return (
    <main className="wrap sanctuary">
      <header className="nav">
        <Link className="brand" href="/">
          TSLAx Vault
        </Link>
        <WalletMultiButton />
      </header>

      <h1>The Sanctuary</h1>
      {!connected ? (
        <>
          <p className="muted">
            Connect a Devnet wallet to deposit TSLAx and watch yield accrue.
          </p>
          <p className="fine">{providerState}.</p>
        </>
      ) : (
        <>
          <p>
            <span className="dot" /> Connected {shortKey(publicKey?.toBase58() ?? "")}
          </p>
          <p className="muted">
            Deposit and withdraw wiring arrives in Phase 8. Your TSLAx balance
            and live Kamino yield will appear here.
          </p>
        </>
      )}
    </main>
  );
}

function shortKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 4)}...${key.slice(-4)}` : key;
}
