"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";

export default function ConnectWalletButton() {
  const { connected, publicKey, select, wallets } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [phantomInstalled, setPhantomInstalled] = useState(false);
  const [solflareInstalled, setSolflareInstalled] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const phantom = (window as any).phantom?.solana;
      const solflare = (window as any).solflare?.isSolflare;
      setPhantomInstalled(!!phantom?.isPhantom);
      setSolflareInstalled(!!solflare);
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
    const short = publicKey.toBase58().slice(0, 4) + "…" + publicKey.toBase58().slice(-4);
    return (
      <div className="wallet-connected">
        <span className="wallet-dot" aria-hidden="true" />
        <span className="wallet-address">{short}</span>
        <button className="wallet-disconnect" onClick={() => select(null)} aria-label="Disconnect wallet">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 17L7 7M7 17L17 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  const phantomWallet = wallets.find(w => w.adapter.name === "Phantom");
  const solflareWallet = wallets.find(w => w.adapter.name === "Solflare");

  const handleConnect = async (walletAdapter: typeof phantomWallet) => {
    if (walletAdapter) {
      await walletAdapter.adapter.connect();
    }
  };

  return (
    <div className="wallet-connect-group">
      {phantomInstalled && phantomWallet && (
        <button
          className="wallet-btn wallet-btn--primary"
          onClick={() => handleConnect(phantomWallet)}
          aria-label="Connect with Phantom"
        >
          <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHBhdGggZD0iTTE2IDJjLjU1IDAgMS4wNC4yMiAxLjQxLjU5bC0yLjI3IDIuMjdhMTUuMDYgMTUuMDYgMCAwIDEgLTEuMDYgMS4wNmwtNC41OCA0LjU4YTE1LjA2IDE1LjA2IDAgMCAxLTIuMTIgMGMtLjM2IDAtLjcxLjEyLTEgLjM0bC0yLjU3IDIuNTdhMTUuMDYgMTUuMDYgMCAwIDAgMS4wNiAxLjA2bDQuNTggNC41OGEyLjUgMi41IDAgMCAwIDMuNTQgMGw0LjU4LTQuNThjMS40Mi0xLjQyIDEuNDItMy43MSAwLTUuMTNsLTIuNTctMi41N2ExNS4wNiAxNS4wNiAwIDAgMC0xLjA2LTFMOC45IDkuNjRhMTUuMDYgMTUuMDYgMCAwIDEgMC0yLjEybDIuMjctMi4yN2ExNS4wNiAxNS4wNiAwIDAgMSAwLTIuMTJsLTQuNTgtNC41OGEyLjUgMi41IDAgMCAwLTMuNTQgMGwtNC41OCA0LjU4YTE1LjA2IDE1LjA2IDAgMCAwIDEuMDYgMS4wNmw0LjU4IDQuNThjMS40MiAxLjQyIDMuNzEgMS40MiA1LjEzIDBsMi41NyAyLjU3YzEuNDEgMS40MSAzLjcxIDEuNDEgNS4xMyAwbDQuNTggNC41OGMxLjQyIDEuNDIgMy43MSAxLjQyIDUuMTMgMGwyLjU3LTIuNTdjMS40MS0xLjQxIDEuNDEtMy43MSAwLTUuMTNsLTQuNTgtNC41OGMtMS40Mi0xLjQyLTMuNzEtMS40Mi01LjEzIDBsLTIuNTcgMi41N2MtLjI5LS4yOS0uNTUtLjYzLS44NC0xbC00LjU4IDQuNThjLTEuNDItMS40Mi0zLjcxLTEuNDItNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42My0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy43MS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42My0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy43MS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy43MS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy43MS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjU3LTIuNTdjLS4yOS0uMjktLjU1LS42Mi0uODQtMWwtNC41OCA0LjU4Yy0xLjQyLTEuNDItMy4zMS0xLjQtNS4xMyAwbC0yLjUzLz4KPC9zdmc+" alt="Phantom" />
          <span>Phantom</span>
          <span className="wallet-badge">Recommended</span>
        </button>
      )}

      {solflareInstalled && solflareWallet && (
        <button
          className="wallet-btn wallet-btn--secondary"
          onClick={() => handleConnect(solflareWallet)}
          aria-label="Connect with Solflare"
        >
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#00C896" />
            <path d="M8 16L14 22L24 8" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Solflare</span>
        </button>
      )}

      {wallets.length > 0 && (
        <button
          className="wallet-btn wallet-btn--tertiary"
          onClick={() => {
            const modal = document.querySelector('[data-wallet-modal]');
            if (modal) (modal as any).open?.();
          }}
          aria-label="More wallets"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span>More</span>
        </button>
      )}
    </div>
  );
}