"use client";

import { useAnchorWallet,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TSLAX_MINT } from "../../config";
import { fetchReserveSnapshot } from "../../yield";
import {
  buildDepositTx,
  buildWithdrawTx,
  deriveAddresses,
  getProgram,
  toBaseUnits,
  toUiAmount,
  tokenBalance,
} from "../../vault";
import ThemeToggle from "@/components/ThemeToggle";

type Balances = {
  tslax: bigint | null;
  ytslax: bigint | null;
  rate: number | null;
};

/**
 * Sanctuary dashboard (Phases 8-9): real balances, real deposits/withdrawals
 * against the deployed vault program, and a live position value computed
 * from the on-chain Kamino cToken exchange rate. Nothing is simulated.
 */
export default function Dashboard() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [balances, setBalances] = useState<Balances>({ tslax: null, ytslax: null, rate: null });
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [providerState, setProviderState] = useState("checking");

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w.solana || w.phantom) setProviderState("solana provider detected");
    else setProviderState("no Solana provider detected in this browser");
  }, []);

  const refresh = useCallback(async () => {
    if (!connected || !publicKey) return;
    try {
      const tslaxMint = new PublicKey(TSLAX_MINT);
      const { receiptMint } = deriveAddresses();
      const [tslax, ytslax, snap] = await Promise.all([
        tokenBalance(connection, getAssociatedTokenAddressSync(tslaxMint, publicKey)),
        tokenBalance(connection, getAssociatedTokenAddressSync(receiptMint, publicKey)).catch(
          () => null
        ),
        fetchReserveSnapshot().catch(() => null),
      ]);
      setBalances({ tslax, ytslax, rate: snap ? snap.rate : null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load balances.");
    }
  }, [connected, publicKey, connection]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15000);
    return () => clearInterval(id);
  }, [refresh]);

  async function submit(build: () => Promise<{ sig: string }>) {
    setError("");
    setBusy(true);
    try {
      const { sig } = await build();
      await connection.confirmTransaction(sig, "confirmed");
      setAmount("");
      await refresh();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function onDeposit() {
    if (!publicKey || !anchorWallet) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    void submit(async () => {
      const program = getProgram(connection, anchorWallet);
      const { tx } = await buildDepositTx(program, publicKey, toBaseUnits(parsed));
      const sig = await sendTransaction(tx, connection);
      return { sig };
    });
  }

  function onWithdraw() {
    if (!publicKey || !anchorWallet) return;
    if (balances.ytslax === null || balances.ytslax === 0n) {
      setError("No vault position to withdraw.");
      return;
    }
    const shares = balances.ytslax;
    void submit(async () => {
      const program = getProgram(connection, anchorWallet);
      const tx = await buildWithdrawTx(program, publicKey, shares);
      const sig = await sendTransaction(tx, connection);
      return { sig };
    });
  }

  const positionValue =
    balances.ytslax !== null && balances.rate !== null
      ? toUiAmount(balances.ytslax) * balances.rate
      : null;

  return (
    <main className="wrap sanctuary">
      <header className="nav">
        <Link className="brand" href="/">
          TSLAx Vault
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <ThemeToggle />
          <WalletMultiButton />
        </div>
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
        <div>
          <p>
            <span className="dot" /> Connected {shortKey(publicKey?.toBase58() ?? "")}
          </p>
          <div className="cards">
            <div className="card">
              <span className="label">Wallet TSLAx</span>
              <strong>{fmt(balances.tslax)}</strong>
            </div>
            <div className="card accent-card">
              <span className="label">Vault position</span>
              <strong>
                {positionValue === null ? "—" : `${positionValue.toFixed(6)} TSLAx`}
              </strong>
              <span className="fine">
                {balances.ytslax === null
                  ? "no position"
                  : `${toUiAmount(balances.ytslax).toFixed(6)} yTSLAx`}
                {balances.rate !== null ? ` at rate ${balances.rate.toFixed(6)}` : ""}
              </span>
            </div>
          </div>
          <div className="actions">
            <input
              className="input"
              type="number"
              min="0"
              step="any"
              placeholder="Amount in TSLAx"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
            />
            <button className="cta" onClick={onDeposit} disabled={busy}>
              {busy ? "Working" : "Deposit and Earn"}
            </button>
            <button className="ghost" onClick={onWithdraw} disabled={busy}>
              Withdraw
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
        </div>
      )}
    </main>
  );
}

function fmt(v: bigint | null): string {
  return v === null ? "—" : `${toUiAmount(v).toFixed(6)} TSLAx`;
}

function shortKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 4)}...${key.slice(-4)}` : key;
}

function userMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Transaction failed.";
  if (/user rejected|rejected/i.test(msg)) return "Transaction rejected in wallet.";
  if (/insufficient/i.test(msg)) return "Insufficient balance for this action.";
  if (/not deployed/i.test(msg)) return msg;
  return msg.length > 220 ? `${msg.slice(0, 220)}...` : msg;
}
