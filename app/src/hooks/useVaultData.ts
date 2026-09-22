"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { TSLAX_MINT } from "../config";
import { fetchPoolSnapshot, PoolSnapshot } from "../yield";
import { fetchVaultHistory, VaultEvent } from "../history";
import { friendlyError } from "../errors";
import { ensureBaseline, profitUi } from "../flows";
import { deriveAddresses, toUiAmount, tokenBalance } from "../vault";
import { useToasts } from "@/components/Toasts";

export type Balances = {
  tslax: bigint | null;
  ntsla: bigint | null;
};

/** Shared vault data: balances, pool snapshot, profit, history + refreshers. */
export function useVaultData() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [balances, setBalances] = useState<Balances>({ tslax: null, ntsla: null });
  const [pool, setPool] = useState<PoolSnapshot | null>(null);
  const [history, setHistory] = useState<VaultEvent[]>([]);
  const [providerState, setProviderState] = useState("checking");
  const { toasts, push, dismiss } = useToasts();

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w.phantom) setProviderState("Phantom detected");
    else setProviderState("Phantom not detected in this browser — install Phantom to continue");
  }, []);

  const refresh = useCallback(async () => {
    if (!connected || !publicKey) return;
    try {
      const tslaxMint = new PublicKey(TSLAX_MINT);
      const { receiptMint } = deriveAddresses();
      const [tslax, ntsla, snap] = await Promise.all([
        tokenBalance(connection, getAssociatedTokenAddressSync(tslaxMint, publicKey)),
        tokenBalance(connection, getAssociatedTokenAddressSync(receiptMint, publicKey)).catch(() => null),
        fetchPoolSnapshot(connection).catch(() => null),
      ]);
      setBalances({ tslax, ntsla });
      if (snap) setPool(snap);
    } catch (e) {
      push(friendlyError(e));
    }
  }, [connected, publicKey, connection, push]);

  const refreshHistory = useCallback(async () => {
    if (!connected || !publicKey) return;
    try {
      setHistory(await fetchVaultHistory(connection, publicKey));
    } catch {
      /* history is best-effort, balances matter more */
    }
  }, [connected, publicKey, connection]);

  useEffect(() => {
    void refresh();
    void refreshHistory();
    const id = setInterval(() => void refresh(), 15000);
    return () => clearInterval(id);
  }, [refresh, refreshHistory]);

  // Simulated borrow-interest crank: keeps yield visibly ticking on devnet.
  // Server rate-limits to one drip per 5 min; failures are silent.
  useEffect(() => {
    if (!connected) return;
    let stopped = false;
    const crank = async () => {
      try {
        const res = await fetch("/api/crank", { method: "POST" });
        if (res.ok && !stopped) await refresh();
      } catch {
        /* crank is best-effort */
      }
    };
    void crank();
    const id = setInterval(() => void crank(), 5 * 60 * 1000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [connected, refresh]);

  const refreshAll = useCallback(async () => {
    await refresh();
    await refreshHistory();
  }, [refresh, refreshHistory]);

  const rate = pool?.rate ?? null;
  const apy = pool?.apyPct ?? null;
  const positionValue =
    balances.ntsla !== null && rate !== null ? toUiAmount(balances.ntsla) * rate : null;
  const totalValue =
    positionValue !== null
      ? positionValue + (balances.tslax !== null ? toUiAmount(balances.tslax) : 0)
      : null;

  const ownerKey = publicKey?.toBase58() ?? null;
  if (ownerKey && balances.ntsla !== null && rate !== null && rate > 0) {
    ensureBaseline(ownerKey, BigInt(Math.floor(toUiAmount(balances.ntsla) * rate * 10 ** 6)));
  }
  const { profit } = profitUi(positionValue, ownerKey);

  return {
    connection,
    connected,
    publicKey,
    sendTransaction,
    balances,
    pool,
    rate,
    apy,
    positionValue,
    totalValue,
    profit,
    history,
    refresh,
    refreshHistory,
    refreshAll,
    toasts,
    push,
    dismiss,
    providerState,
  };
}
