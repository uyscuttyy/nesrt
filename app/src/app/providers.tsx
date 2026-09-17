"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { useMemo, useEffect, useState } from "react";
import { SOLANA_RPC_URL } from "../config";
import { ThemeProvider } from "@/components/ThemeProvider";

import "@solana/wallet-adapter-react-ui/styles.css";

export default function Providers({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter({ autoConnect: false }),
      new SolflareWalletAdapter(),
    ],
    []
  );

  // Auto-detect Phantom and set as preferred
  useEffect(() => {
    if (typeof window !== "undefined") {
      const phantom = (window as any).phantom?.solana;
      if (phantom?.isPhantom) {
        localStorage.setItem("wallet-adapter:selected-wallet", "Phantom");
      }
    }
  }, []);

  return (
    <ThemeProvider>
      <ConnectionProvider endpoint={SOLANA_RPC_URL}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </ThemeProvider>
  );
}
