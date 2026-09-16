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
import { fetchVaultHistory, VaultEvent } from "../../history";
import { friendlyError } from "../../errors";
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
import { ToastStack, useToasts } from "@/components/Toasts";
import OnboardingModal from "@/components/OnboardingModal";
import YieldChart from "@/components/YieldChart";

type Balances = {
  tslax: bigint | null;
  ytslax: bigint | null;
  rate: number | null;
};

/**
 * Sanctuary dashboard: real balances, real deposits/withdrawals
 * against the deployed vault program, live position value from the
 * on-chain Kamino cToken exchange rate, yield chart, and real
 * transaction history. Nothing is simulated.
 */
export default function Dashboard() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [balances, setBalances] = useState<Balances>({ tslax: null, ytslax: null, rate: null });
  const [amount, setAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<VaultEvent[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [providerState, setProviderState] = useState("checking");
  const { toasts, push, dismiss } = useToasts();

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

  useEffect(() => {
    if (!connected || !publicKey) return;
    try {
      if (!localStorage.getItem(`tslax-onboarded-${publicKey.toBase58()}`)) {
        setShowOnboarding(true);
      }
    } catch {
      setShowOnboarding(true);
    }
  }, [connected, publicKey]);

  function closeOnboarding() {
    try {
      if (publicKey) localStorage.setItem(`tslax-onboarded-${publicKey.toBase58()}`, "1");
    } catch {
      /* ignore */
    }
    setShowOnboarding(false);
  }

  async function submit(build: () => Promise<{ sig: string }>) {
    setBusy(true);
    try {
      const { sig } = await build();
      await connection.confirmTransaction(sig, "confirmed");
      setAmount("");
      setWithdrawAmount("");
      await refresh();
      await refreshHistory();
    } catch (e) {
      push(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  function onDeposit() {
    if (!publicKey || !anchorWallet) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      push("Enter an amount greater than zero.");
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
      push("No vault position to withdraw.");
      return;
    }
    let shares = balances.ytslax;
    const parsed = withdrawAmount.trim() === "" ? NaN : Number(withdrawAmount);
    if (!Number.isNaN(parsed)) {
      if (!Number.isFinite(parsed) || parsed <= 0) {
        push("Enter a withdraw amount greater than zero.");
        return;
      }
      if (balances.rate === null || balances.rate <= 0) {
        push("Live rate is unavailable. Try again in a moment.");
        return;
      }
      const wanted = BigInt(Math.floor((parsed * 10 ** 6) / balances.rate));
      if (wanted <= 0n) {
        push("That amount is too small to withdraw.");
        return;
      }
      if (wanted > balances.ytslax) {
        push("That amount is more than your vault position.");
        return;
      }
      shares = wanted;
    }
    const finalShares = shares;
    void submit(async () => {
      const program = getProgram(connection, anchorWallet);
      const tx = await buildWithdrawTx(program, publicKey, finalShares);
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
          <YieldChart value={positionValue} />
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
          </div>
          <div className="actions">
            <input
              className="input"
              type="number"
              min="0"
              step="any"
              placeholder="Withdraw amount, empty for full"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              disabled={busy}
            />
            <button className="ghost" onClick={onWithdraw} disabled={busy}>
              Withdraw
            </button>
          </div>
          <HistoryTimeline events={history} />
        </div>
      )}
      {showOnboarding && connected ? (
        <OnboardingModal
          onFunded={() => {
            void refresh();
            void refreshHistory();
          }}
          onClose={closeOnboarding}
        />
      ) : null}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </main>
  );
}

function HistoryTimeline({ events }: { events: VaultEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="card">
      <span className="label">Transaction history</span>
      <ul className="timeline">
        {events.map((e) => (
          <li key={e.signature}>
            <strong>{e.kind === "deposit" ? "Deposit" : "Withdraw"}</strong>{" "}
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

function fmt(v: bigint | null): string {
  return v === null ? "—" : `${toUiAmount(v).toFixed(6)} TSLAx`;
}

function shortKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 4)}...${key.slice(-4)}` : key;
}
