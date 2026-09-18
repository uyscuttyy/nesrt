"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { useMemo } from "react";
import { SOLANA_RPC_URL } from "../config";
import { ThemeProvider } from "@/components/ThemeProvider";

import "@solana/wallet-adapter-react-ui/styles.css";

/** Phantom-only. No other wallets registered by design. */
export default function Providers({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

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
