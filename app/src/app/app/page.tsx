"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TSLAX_MINT, LB_PAIR_ADDRESS } from "../../config";
import { fetchPoolSnapshot, PoolSnapshot } from "../../yield";
import { fetchVaultHistory, invalidateHistoryCache, VaultEvent } from "../../history";
import { friendlyError } from "../../errors";
import { ensureBaseline, profitUi, recordFlow } from "../../flows";
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
import JupiterZapModal from "@/components/JupiterZapModal";

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
  const [tab, setTab] = useState<"vault" | "unvault" | "zap">("vault");
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

  async function submit(
    build: () => Promise<{ sig: string }>,
    flow?: "deposit" | "withdraw",
    retries = 1
  ) {
    const before = balances.tslax;
    setBusy(true);
    try {
      const { sig } = await build();
      await connection.confirmTransaction(sig, "confirmed");
      setAmount("");
      await refresh();
      if (publicKey) invalidateHistoryCache(publicKey);
      await refreshHistory();
      // Record true cost basis from on-chain balance movement (not estimates).
      if (flow && publicKey && before !== null) {
        try {
          const afterAcc = await connection.getTokenAccountBalance(
            getAssociatedTokenAddressSync(new PublicKey(TSLAX_MINT), publicKey)
          );
          const after = BigInt(afterAcc.value.amount);
          if (flow === "deposit" && after < before) {
            recordFlow(publicKey.toBase58(), "in", before - after);
          } else if (flow === "withdraw" && after > before) {
            recordFlow(publicKey.toBase58(), "out", after - before);
          }
        } catch {
          /* balance read failed — profit falls back gracefully */
        }
      }
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
        return submit(build, flow, retries - 1);
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
      const { tx, extraSigners } = await buildDepositTx(
        connection,
        publicKey,
        toBaseUnits(parsed)
      );
      const sig = await sendTransaction(
        tx,
        connection,
        extraSigners.length > 0 ? { signers: extraSigners } : undefined
      );
      return { sig };
    }, "deposit");
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
      const { tx, extraSigners } = await buildWithdrawTx(
        connection,
        publicKey,
        finalShares
      );
      const sig = await sendTransaction(
        tx,
        connection,
        extraSigners.length > 0 ? { signers: extraSigners } : undefined
      );
      return { sig };
    }, "withdraw");
  }

  function useMax() {
    if (tab === "vault") {
      if (balances.tslax !== null) setAmount(toUiAmount(balances.tslax).toString());
    } else if (positionValue !== null) {
      setAmount(positionValue.toString());
    }
  }

  async function refreshAll() {
    await refresh();
    await refreshHistory();
  }

  const rate = pool?.rate ?? null;
  const apy = pool?.apyPct ?? null;
  const positionValue =
    balances.ntsla !== null && rate !== null ? toUiAmount(balances.ntsla) * rate : null;
  const totalValue =
    positionValue !== null
      ? positionValue + (balances.tslax !== null ? toUiAmount(balances.tslax) : 0)
      : null;

  // True profit (position + withdrawn − deposited), baselined once so legacy
  // positions start at 0 instead of reading deposits as profit.
  const ownerKey = publicKey?.toBase58() ?? null;
  if (ownerKey && balances.ntsla !== null && rate !== null && rate > 0) {
    ensureBaseline(
      ownerKey,
      BigInt(Math.floor(toUiAmount(balances.ntsla) * rate * 10 ** 6))
    );
  }
  const { profit } = profitUi(positionValue, ownerKey);

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

      <p className="eyebrow">Nesrt Vault · Solana Devnet</p>
      <h1>Put your stocks to work.</h1>

      {!connected ? (
        <>
          <p className="muted">Connect Phantom to vault TSLAx and earn lending yield. No numbers to manage.</p>
          <p className="fine">{providerState}.</p>
        </>
      ) : (
        <div>
          <div className="account-bar">
            <span>
              <span className="dot" /> Connected {shortKey(publicKey?.toBase58() ?? "")} · Phantom
            </span>
            <button className="ghost ghost-sm" onClick={() => void onFaucet()} disabled={busy}>
              {busy ? "Working…" : "Get 100 test TSLAx"}
            </button>
          </div>

          <div className="cards">
            <div className="card accent-card">
              <span className="label">Total Value</span>
              <strong>{totalValue === null ? "—" : `${totalValue.toFixed(6)} TSLAx`}</strong>
              <span className="fine">Wallet + vaulted, live.</span>
            </div>
            <div className="card">
              <span className="label">Wallet TSLAx</span>
              <strong>{fmt(balances.tslax)}</strong>
            </div>
            <div className="card">
              <span className="label">Vaulted TSLAx</span>
              <strong>{positionValue === null ? "—" : `${positionValue.toFixed(6)} TSLAx`}</strong>
              <span className="fine">
                Working in the lending pool. Withdraw anytime.
                {balances.ntsla !== null && balances.ntsla > 0n
                  ? ` Wallet holds ${toUiAmount(balances.ntsla).toFixed(2)} nTSLA (nTSLA moved to Meteora no longer counts here).`
                  : ""}
              </span>
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
          </div>

          <div className="card action-card">
            <div className="tabs" role="tablist">
              {(
                [
                  ["vault", "Vault"],
                  ["unvault", "Unvault"],
                  ["zap", "Zap ⚡"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  className={tab === key ? "tab tab-active" : "tab"}
                  onClick={() => setTab(key)}
                  disabled={busy}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "zap" ? (
              <div className="tab-pane">
                <JupiterZapModal onDone={() => void refreshAll()} />
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>

          <YieldChart profit={profit} />

          <TradeCard />

          <HistoryTimeline events={history} />

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
                <div>
                  <Link href="/app/pool">Liquidity pool creator →</Link>
                </div>
              </div>
            ) : null}
          </div>
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

function TradeCard() {
  if (!LB_PAIR_ADDRESS) return null;
  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <span className="label">Trade nTSLA</span>
      <strong className="mono" style={{ fontSize: "1rem" }}>
        nTSLA/USDC · 0.25% fee
      </strong>
      <span className="fine">Live DLMM pool on devnet. Swap without unvaulting.</span>
      <span className="fine">Unverified tokens: Meteora may not load metadata or prices — the pool still works.</span>
      <div className="actions">
        <a
          className="cta"
          style={{ textDecoration: "none" }}
          href={`https://devnet.meteora.ag/dlmm/${LB_PAIR_ADDRESS}`}
          target="_blank"
          rel="noreferrer"
        >
          Trade on Meteora
        </a>
        <a
          className="ghost"
          style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          href={`https://explorer.solana.com/address/${LB_PAIR_ADDRESS}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
        >
          View pool
        </a>
      </div>
    </div>
  );
}

function HistoryTimeline({ events }: { events: VaultEvent[] }) {  if (events.length === 0) return null;
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
