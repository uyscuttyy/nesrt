"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";

/** Phantom-only connect button. Uses the wallet-adapter select+connect flow. */
export default function ConnectWalletButton() {
  const { connected, connecting, publicKey, select, connect, disconnect, wallets } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [phantomInstalled, setPhantomInstalled] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const phantom = (window as unknown as { phantom?: { solana?: { isPhantom?: boolean } } }).phantom?.solana;
      setPhantomInstalled(!!phantom?.isPhantom);
    }
  }, []);

  if (!mounted) {
    return (
      <button className="wallet-btn loading" disabled aria-label="Loading wallet">
        <svg className="spinner" viewBox="0 0 24 24" width="20" height="20">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }} />
        </svg>
      </button>
    );
  }

  if (connected && publicKey) {
    const addr = publicKey.toBase58();
    const short = addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
    return (
      <div className="wallet-connected">
        <span className="wallet-dot" aria-hidden="true" />
        <span className="wallet-address">{short}</span>
        <button className="wallet-disconnect" onClick={() => void disconnect()} aria-label="Disconnect Phantom">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 17L7 7M7 17L17 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  async function handleConnect() {
    try {
      const phantom = wallets.find((w) => w.adapter.name === "Phantom");
      if (phantom) select(phantom.adapter.name);
      // select() then connect() is the supported flow; direct adapter.connect() bypasses state.
      await connect();
    } catch {
      /* user rejected or Phantom locked — wallet-adapter surfaces it, stay idle */
    }
  }

  if (!phantomInstalled) {
    return (
      <a className="wallet-btn wallet-btn--primary" href="https://phantom.app/" target="_blank" rel="noreferrer">
        <span>Get Phantom</span>
      </a>
    );
  }

  return (
    <div className="wallet-connect-group">
      <button
        className="wallet-btn wallet-btn--primary"
        onClick={() => void handleConnect()}
        disabled={connecting}
        aria-label="Connect with Phantom"
      >
        <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="currentColor" opacity="0.2" />
          <path d="M9 11c0-1 1-2 2-2h10c1 0 2 1 2 2v4c0 3-2 5-4 6l-3 2-3-2c-2-1-4-3-4-6v-4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
        <span>{connecting ? "Connecting…" : "Connect Phantom"}</span>
      </button>
    </div>
  );
}
