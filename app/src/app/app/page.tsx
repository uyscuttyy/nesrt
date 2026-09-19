"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TSLAX_MINT } from "../../config";
import { fetchPoolSnapshot, PoolSnapshot } from "../../yield";
import { fetchVaultHistory, VaultEvent } from "../../history";
import { friendlyError } from "../../errors";
import {
  buildDepositTx,
  buildWithdrawTx,
  deriveAddresses,
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
  ntsla: bigint | null;
};

/**
 * Sanctuary: 1-click vault. Connect Phantom -> put TSLAx to work -> unvault anytime.
 * Raw protocol dials live behind "Advanced Protocol Details".
 */
export default function Dashboard() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [balances, setBalances] = useState<Balances>({ tslax: null, ntsla: null });
  const [pool, setPool] = useState<PoolSnapshot | null>(null);
  const [amount, setAmount] = useState("");
  const [tab, setTab] = useState<"vault" | "unvault">("vault");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<VaultEvent[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
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

  useEffect(() => {
    if (!connected || !publicKey) return;
    try {
      if (!localStorage.getItem(`nesrt-onboarded-${publicKey.toBase58()}`)) setShowOnboarding(true);
    } catch {
      setShowOnboarding(true);
    }
  }, [connected, publicKey]);

  function closeOnboarding() {
    try {
      if (publicKey) localStorage.setItem(`nesrt-onboarded-${publicKey.toBase58()}`, "1");
    } catch {
      /* ignore */
    }
    setShowOnboarding(false);
  }

  /** Manual faucet: mints 100 test TSLAx, always available (modal is one-time). */
  async function onFaucet() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: publicKey.toBase58() }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "TSLAx faucet failed.");
      push("100 test TSLAx minted to your wallet.");
      await refresh();
    } catch (e) {
      push(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(build: () => Promise<{ sig: string }>, retries = 1) {
    setBusy(true);
    try {
      const { sig } = await build();
      await connection.confirmTransaction(sig, "confirmed");
      setAmount("");
      await refresh();
      await refreshHistory();
    } catch (e) {
      // Devnet RPC flakes (stale blockhash, 429, preflight timeouts): nothing
      // landed, so one retry with a fresh transaction is safe.
      const msg = e instanceof Error ? e.message : "";
      const transient =
        retries > 0 &&
        !/confirm/i.test(msg) &&
        (/blockhash|expired|timeout|429|rate.?limit|simulation failed|failed to fetch/i.test(msg));
      if (transient) {
        await new Promise((r) => setTimeout(r, 1200));
        setBusy(false);
        return submit(build, retries - 1);
      }
      push(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  function onPutToWork() {
    if (!publicKey) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      push("Enter an amount greater than zero.");
      return;
    }
    void submit(async () => {
      const { tx } = await buildDepositTx(connection, publicKey, toBaseUnits(parsed));
      const sig = await sendTransaction(tx, connection);
      return { sig };
    });
  }

  function onUnvault(full: boolean) {
    if (!publicKey) return;
    if (balances.ntsla === null || balances.ntsla === 0n) {
      push("No vault position to unvault.");
      return;
    }
    let shares = balances.ntsla;
    if (!full) {
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        push("Enter an amount greater than zero.");
        return;
      }
      if (!pool || pool.rate <= 0) {
        push("Live rate is unavailable. Try again in a moment.");
        return;
      }
      const wanted = BigInt(Math.floor((parsed * 10 ** 6) / pool.rate));
      if (wanted <= 0n) {
        push("That amount is too small to unvault.");
        return;
      }
      if (wanted > balances.ntsla) {
        push("That amount is more than your vault position.");
        return;
      }
      shares = wanted;
    }
    const finalShares = shares;
    void submit(async () => {
      const tx = await buildWithdrawTx(connection, publicKey, finalShares);
      const sig = await sendTransaction(tx, connection);
      return { sig };
    });
  }

  function useMax() {
    if (tab === "vault") {
      if (balances.tslax !== null) setAmount(toUiAmount(balances.tslax).toString());
    } else if (positionValue !== null) {
      setAmount(positionValue.toString());
    }
  }

  const rate = pool?.rate ?? null;
  const apy = pool?.apyPct ?? null;
  const positionValue =
    balances.ntsla !== null && rate !== null ? toUiAmount(balances.ntsla) * rate : null;
  const totalValue =
    positionValue !== null
      ? positionValue + (balances.tslax !== null ? toUiAmount(balances.tslax) : 0)
      : null;

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

      <h1>Put your stocks to work.</h1>

      {!connected ? (
        <>
          <p className="muted">Connect Phantom to vault TSLAx and earn lending yield. No numbers to manage.</p>
          <p className="fine">{providerState}.</p>
        </>
      ) : (
        <div>
          <p>
            <span className="dot" /> Connected {shortKey(publicKey?.toBase58() ?? "")} · Phantom
          </p>
          <div className="actions" style={{ marginTop: "1rem" }}>
            <button className="ghost" onClick={() => void onFaucet()} disabled={busy}>
              {busy ? "Working…" : "Get 100 test TSLAx"}
            </button>
          </div>

          <div className="cards">
            <div className="card">
              <span className="label">Wallet TSLAx</span>
              <strong>{fmt(balances.tslax)}</strong>
            </div>
            <div className="card accent-card">
              <span className="label">Vaulted TSLAx</span>
              <strong>{positionValue === null ? "—" : `${positionValue.toFixed(6)} TSLAx`}</strong>
              <span className="fine">Working in the lending pool. Withdraw anytime.</span>
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
              <span className="label">Total Value</span>
              <strong>{totalValue === null ? "—" : `${totalValue.toFixed(6)} TSLAx`}</strong>
            </div>
          </div>

          <YieldChart value={positionValue} />

          <div className="card" style={{ marginTop: "1rem" }}>
            <div className="actions" style={{ marginTop: 0 }}>
              <button className={tab === "vault" ? "cta" : "ghost"} onClick={() => setTab("vault")} disabled={busy}>
                Vault
              </button>
              <button className={tab === "unvault" ? "cta" : "ghost"} onClick={() => setTab("unvault")} disabled={busy}>
                Unvault Capital
              </button>
            </div>
            <div className="actions">
              <input
                className="input"
                type="number"
                min="0"
                step="any"
                placeholder={tab === "vault" ? "Amount of TSLAx to Vault" : "Amount to unvault, empty for full"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={busy}
                style={{ fontSize: "1.15rem", fontWeight: 600 }}
              />
              <button className="ghost" onClick={useMax} disabled={busy}>
                Max
              </button>
            </div>
            {tab === "vault" ? (
              <div className="actions">
                <button className="cta" onClick={onPutToWork} disabled={busy}>
                  {busy ? "Working…" : "Put Capital to Work"}
                </button>
              </div>
            ) : (
              <div className="actions">
                <button className="cta" onClick={() => onUnvault(false)} disabled={busy}>
                  {busy ? "Working…" : "Unvault Capital"}
                </button>
                <button className="ghost" onClick={() => onUnvault(true)} disabled={busy}>
                  Unvault All
                </button>
              </div>
            )}
            <p className="fine">One click. No pools, rates, or LTVs to manage.</p>
          </div>

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
              </div>
            ) : null}
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

function fmt(v: bigint | null): string {
  return v === null ? "—" : `${toUiAmount(v).toFixed(6)} TSLAx`;
}

function shortKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 4)}...${key.slice(-4)}` : key;
}
