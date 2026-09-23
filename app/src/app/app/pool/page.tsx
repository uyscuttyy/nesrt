"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useCallback, useEffect, useState } from "react";
import BN from "bn.js";
import { TSLAX_MINT } from "../../../config";
import { deriveAddresses } from "../../../vault";
import { friendlyError } from "../../../errors";
import Navbar from "@/components/Navbar";
import { ToastStack, useToasts } from "@/components/Toasts";

const BIN_STEP = 25;
const FEE_BPS = 25; // 0.25%
const TARGET_PRICE = 1.0; // 1 nTSLA = 1 USDC
const PAIR_KEY = "nesrt-lb-pair";
const SEED_X_BASE = 10_000_000n; // 10 USDC (6 decimals, tokenX sorts first)
const SEED_Y_BASE = 10_000_000n; // 10 nTSLA
const SEED_HALF_WIDTH_BINS = 10;

type QuoteToken = { mint: string; amountUi: number };

/**
 * Permissionless nTSLA/USDC DLMM pool creation with a custom 0.25% fee.
 * Meteora's UI only offers a 10% tier for unverified devnet tokens, so we
 * build the customizable-permissionless transaction here and the user signs
 * with Phantom. Liquidity is added afterwards on Meteora's pool page.
 */
export default function PoolPage() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [quote, setQuote] = useState<QuoteToken | null>(null);
  const [scanning, setScanning] = useState(false);
  const [existingPair, setExistingPair] = useState<string | null>(null);
  const [createdPair, setCreatedPair] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const { toasts, push, dismiss } = useToasts();

  const scanQuote = useCallback(async () => {
    if (!connected || !publicKey) return;
    setScanning(true);
    try {
      const { receiptMint } = deriveAddresses();
      const excluded = new Set([TSLAX_MINT, receiptMint.toBase58()]);
      const resp = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: TOKEN_PROGRAM_ID,
      });
      const candidates: QuoteToken[] = [];
      for (const acc of resp.value) {
        const info = (acc.account.data as unknown as { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } }).parsed?.info;
        if (!info?.mint || excluded.has(info.mint)) continue;
        const amt = info.tokenAmount?.uiAmount ?? 0;
        if (amt > 0) candidates.push({ mint: info.mint, amountUi: amt });
      }
      candidates.sort((a, b) => b.amountUi - a.amountUi);
      setQuote(candidates[0] ?? null);
      if (!candidates[0]) setNote("No USDC-like token found. Get devnet USDC from faucet.circle.com first.");
    } catch (e) {
      push(friendlyError(e));
    } finally {
      setScanning(false);
    }
  }, [connected, publicKey, connection, push]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PAIR_KEY);
      if (saved) setCreatedPair(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void scanQuote();
  }, [scanQuote]);

  useEffect(() => {
    (async () => {
      if (!quote) return;
      try {
        const DLMM = resolveDLMM(await import("@meteora-ag/dlmm"));
        const { receiptMint } = deriveAddresses();
        const mints = [new PublicKey(receiptMint.toBase58()), new PublicKey(quote.mint)].sort((a, b) =>
          a.toBuffer().compare(b.toBuffer())
        );
        // NOTE: the SDK's *IfExists only derives the PDA — verify the account.
        const found = await DLMM.getCustomizablePermissionlessLbPairIfExists(
          connection,
          mints[0],
          mints[1],
          { cluster: "devnet" } as never
        );
        const live = found ? await connection.getAccountInfo(found) : null;
        setExistingPair(live ? found!.toBase58() : null);
      } catch {
        setExistingPair(null);
      }
    })();
  }, [quote, connection]);

  async function onCreate() {
    if (!publicKey || !quote) return;
    setBusy(true);
    setNote("");
    try {
      const DLMMmod = await import("@meteora-ag/dlmm");
      const DLMM = resolveDLMM(DLMMmod);
      const ActivationType = (
        DLMMmod as unknown as { ActivationType?: { Slot: number } }
      ).ActivationType ?? { Slot: 0 };
      const { receiptMint } = deriveAddresses();
      const mints = [new PublicKey(receiptMint.toBase58()), new PublicKey(quote.mint)].sort((a, b) =>
        a.toBuffer().compare(b.toBuffer())
      );
      const already = await DLMM.getCustomizablePermissionlessLbPairIfExists(
        connection,
        mints[0],
        mints[1],
        { cluster: "devnet" } as never
      );
      const alreadyLive = already ? await connection.getAccountInfo(already) : null;
      if (already && alreadyLive) {
        setExistingPair(already.toBase58());
        setNote("Pool already exists — no need to create it.");
        return;
      }
      const activeId = DLMM.getBinIdFromPrice(TARGET_PRICE, BIN_STEP, false);
      // Activation must lie in the future at execution time (slots ~400ms).
      // Generous buffer: users can take minutes on the approval dialog.
      const slot = (await connection.getSlot("confirmed")) + 3600;
      const tx = await DLMM.createCustomizablePermissionlessLbPair2(
        connection,
        new BN(BIN_STEP),
        mints[0],
        mints[1],
        new BN(activeId),
        new BN(FEE_BPS),
        ActivationType.Slot,
        false,
        publicKey,
        new BN(slot),
        undefined,
        undefined,
        undefined,
        { cluster: "devnet" } as never
      );
      // Set payer + blockhash explicitly: the wallet adapter throws an opaque
      // error when it must prepare these itself on a heavy SDK transaction.
      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const sig = await sendTransaction(tx, connection);
      const conf = await connection.confirmTransaction(sig, "confirmed");
      if (conf.value.err) {
        const failed = await connection
          .getTransaction(sig, { maxSupportedTransactionVersion: 0 })
          .catch(() => null);
        const logs = failed?.meta?.logMessages?.slice(-4).join(" | ") ?? "";
        throw new Error(`Pool transaction failed on-chain: ${JSON.stringify(conf.value.err)} ${logs}`.slice(0, 300));
      }
      // Verify the pair account actually exists (a derived address proves nothing).
      const derived = await DLMM.getCustomizablePermissionlessLbPairIfExists(
        connection,
        mints[0],
        mints[1],
        { cluster: "devnet" } as never
      );
      const onchain = derived ? await connection.getAccountInfo(derived) : null;
      if (!derived || !onchain) {
        throw new Error(`Transaction confirmed but no pair account found for ${derived ? derived.toBase58() : "unknown"}.`);
      }
      const addr = derived.toBase58();
      if (addr) {
        try {
          localStorage.setItem(PAIR_KEY, addr);
        } catch {
          /* ignore */
        }
        setCreatedPair(addr);
      }
      setNote(sig ? `Pool created. Signature: ${sig}` : "Pool created.");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const stack =
        e instanceof Error && e.stack
          ? e.stack.split("\n").slice(0, 4).join(" | ").slice(0, 400)
          : "";
      console.error("[pool]", e);
      // Show the raw message too so it can be pasted back for debugging.
      setNote(`Failed: ${raw.slice(0, 300)}${stack ? `: ${stack}` : ""}`);
      push(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const shownPair = createdPair ?? existingPair;

  const [poolStatus, setPoolStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!shownPair) {
        setPoolStatus(null);
        return;
      }
      try {
        const DLMMmod = await import("@meteora-ag/dlmm");
        const DLMM = resolveDLMM(DLMMmod);
        const dlmm = await DLMM.create(connection, new PublicKey(shownPair), {
          cluster: "devnet",
        } as never);
        const activeBin: number = dlmm.lbPair?.activeId ?? dlmm.activeBinId;
        const binStep: number = dlmm.lbPair?.binStep ?? BIN_STEP;
        setPoolStatus(
          Number.isFinite(activeBin)
            ? `Live · bin step ${binStep} · active bin ${activeBin}`
            : "Live"
        );
      } catch {
        setPoolStatus("Live (details unavailable)");
      }
    })();
  }, [shownPair, connection]);

  /** Seed 10 USDC + 10 nTSLA into a Spot position around the active bin. */
  async function onSeed() {
    if (!publicKey || !shownPair) return;
    setBusy(true);
    setNote("");
    try {
      const DLMMmod = await import("@meteora-ag/dlmm");
      const DLMM = resolveDLMM(DLMMmod);
      const m = DLMMmod as unknown as Record<string, unknown>;
      const StrategyType =
        (m.StrategyType as { Spot?: number } | undefined) ?? { Spot: 0 };
      const LB_PROGRAM_IDS = m.LBCLMM_PROGRAM_IDS as
        | { devnet?: string }
        | undefined;
      const lbProgramId = new PublicKey(
        LB_PROGRAM_IDS?.devnet ?? "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"
      );
      const pairKey = new PublicKey(shownPair);
      const pairInfo = await connection.getAccountInfo(pairKey);
      if (!pairInfo) throw new Error("Pair account not found on-chain yet.");
      const dlmm = await DLMM.create(connection, pairKey, {
        cluster: "devnet",
      } as never);
      const activeBin: number = dlmm.lbPair?.activeId ?? dlmm.activeBinId;
      if (!Number.isFinite(activeBin)) throw new Error("Could not read pool active bin.");
      const minBin = activeBin - SEED_HALF_WIDTH_BINS;
      const maxBin = activeBin + SEED_HALF_WIDTH_BINS;
      setNote(`Active bin ${activeBin}. Initializing bin arrays ${minBin}…${maxBin}…`);

      // Collect unique bin-array indexes covering the range.
      const toIdx = (id: number): number => {
        const fn = m.binIdToBinArrayIndex as
          | ((binId: unknown) => { toNumber?: () => number } | number)
          | undefined;
        if (fn) {
          const v = fn(new BN(id));
          return typeof v === "number" ? v : v.toNumber ? v.toNumber() : Math.floor(id / 70);
        }
        return Math.floor(id / 70);
      };
      const idxSet = new Set<number>();
      for (let b = minBin; b <= maxBin; b++) idxSet.add(toIdx(b));
      const deriveBinArray = m.deriveBinArray as unknown as
        | ((pair: PublicKey, index: unknown, programId: PublicKey) => [PublicKey, number])
        | undefined;
      const missing: InstanceType<typeof BN>[] = [];
      for (const idx of idxSet) {
        const addr = deriveBinArray
          ? deriveBinArray(pairKey, new BN(idx), lbProgramId)[0]
          : null;
        if (!addr || !(await connection.getAccountInfo(addr))) missing.push(new BN(idx));
      }
      if (missing.length > 0) {
        setNote(`Initializing ${missing.length} bin array(s)… (approve in Phantom)`);
        const ixs = await dlmm.initializeBinArrays(missing, publicKey);
        const tx0 = new Transaction();
        for (const ix of ixs) tx0.add(ix);
        tx0.feePayer = publicKey;
        tx0.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        const sig0 = await sendTransaction(tx0, connection);
        const conf0 = await connection.confirmTransaction(sig0, "confirmed");
        if (conf0.value.err) throw new Error(`Bin array init failed: ${JSON.stringify(conf0.value.err)}`);
      }

      setNote("Creating position + adding 10 USDC + 10 nTSLA… (approve in Phantom)");
      const positionKeypair = Keypair.generate();
      const strategy = {
        maxBinId: maxBin,
        minBinId: minBin,
        strategyType: StrategyType.Spot ?? 0,
      };
      const tx = await dlmm.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: positionKeypair.publicKey,
        totalXAmount: new BN(SEED_X_BASE.toString()),
        totalYAmount: new BN(SEED_Y_BASE.toString()),
        strategy,
        user: publicKey,
        slippage: 1,
      });
      const txs = Array.isArray(tx) ? tx : [tx];
      let lastSig = "";
      for (const t of txs) {
        t.feePayer = publicKey;
        t.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        lastSig = await sendTransaction(t, connection, {
          signers: [positionKeypair],
        });
        const conf = await connection.confirmTransaction(lastSig, "confirmed");
        if (conf.value.err) {
          const failed = await connection
            .getTransaction(lastSig, { maxSupportedTransactionVersion: 0 })
            .catch(() => null);
          const logs = failed?.meta?.logMessages?.slice(-4).join(" | ") ?? "";
          throw new Error(`Liquidity failed on-chain: ${JSON.stringify(conf.value.err)} ${logs}`.slice(0, 300));
        }
      }
      setNote(
        `Liquidity seeded. Position ${positionKeypair.publicKey.toBase58()} · ${lastSig}`
      );
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      console.error("[pool-seed]", e);
      setNote(`Failed: ${raw.slice(0, 300)}`);
      push(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <Navbar />
      <div className="wrap sanctuary">
      <p className="eyebrow eyebrow-centered">Nesrt Vault · Solana Devnet</p>
      <h1 className="tagline-boldo page-title">your liquidity pool</h1>
      <p className="muted">
        The shared nTSLA/USDC pool lives here for everyone. Your tokens,
        your balances, and your buttons are yours alone.
      </p>

      {!connected ? (
        <p className="muted">Connect Phantom to continue.</p>
      ) : (
        <div>
          <h2 className="section-title">Your liquidity</h2>
          <div className="cards">
            <div className="card">
              <span className="label">You supply (nTSLA)</span>
              <strong className="mono">{shortKey(deriveAddressesSafe())}</strong>
              <span className="fine">Receipt tokens from your vault position.</span>
            </div>
            <div className="card">
              <span className="label">Paired with (your USDC)</span>
              <strong className="mono">{quote ? `${shortKey(quote.mint)} · ${quote.amountUi}` : scanning ? "scanning…" : "—"}</strong>
              <span className="fine">Auto-detected from your wallet (excludes TSLAx/nTSLA).</span>
            </div>
          </div>

          <h2 className="section-title">How this pool works</h2>
          <div className="facts-list">
            <div className="card fact-row">
              <div>
                <h3>0.25% fee goes to you</h3>
                <p>Every swap pays 0.25%, split across liquidity providers. Lower than stock-exchange spreads, and it lands directly in your position.</p>
              </div>
            </div>
            <div className="card fact-row">
              <div>
                <h3>Bin step 25 sets the price grid</h3>
                <p>Prices move in discrete bins 0.25% apart instead of a smooth curve. Your liquidity sits inside bins; trades hop bin to bin.</p>
              </div>
            </div>
            <div className="card fact-row">
              <div>
                <h3>Your range can run out</h3>
                <p>Seeding covers ±10 bins around 1.0. If price leaves your range you end up 100% in one token and stop earning until it returns. Withdraw and re-seed to follow it.</p>
              </div>
            </div>
          </div>

          <h2 className="section-title">Shared pool facts</h2>
          <div className="cards">
            <div className="card">
              <span className="label">Pool parameters</span>
              <strong>
                0.25% fee · bin 25 · price 1.0
              </strong>
              <span className="fine">Fixed at creation, cannot be changed later.</span>
            </div>
            <div className="card">
              <span className="label">Existing pair</span>
              <strong>{existingPair ? shortKey(existingPair) : "none found"}</strong>
            </div>
          </div>

          <div className="actions">
            <button className="cta" onClick={() => void onCreate()} disabled={busy || !quote || !!existingPair}>
              {busy ? "Working…" : existingPair ? "Pool already exists" : "Create pool (0.25% fee)"}
            </button>
            <button className="ghost" onClick={() => void scanQuote()} disabled={busy || scanning}>
              Rescan wallet
            </button>
          </div>
          {note ? <p className="fine">{note}</p> : null}

          {shownPair ? (
            <div className="card" style={{ marginTop: "1rem" }}>
              <span className="label">Pool status</span>
              <strong>{poolStatus ?? "Checking…"}</strong>
              <span className="fine">nTSLA/USDC liquidity depth and LP controls live on the Meteora pool page.</span>
            </div>
          ) : null}

          <div className="card" style={{ marginTop: "1rem" }}>
            <span className="label">Who can trade here, honestly</span>
            <p className="muted">
              The pool is permissionless: anyone technical can quote and swap
              against it with the SDK. But Meteora&apos;s devnet UI often fails
              to resolve it, so in practice only Nesrt users get a working
              door in today. There is no in-app swap yet, so trading means
              using the Meteora pool page link above. On mainnet this inverts:
              proper indexing plus aggregator routing would make the pair
              reachable from every swap frontend.
            </p>
            <p className="fine">
              Devnet reality check: no volume means no fees accrue. This pool
              exists to prove the full loop (vault, earn, trade), not to earn.
            </p>
          </div>

          {shownPair ? (
            <div className="card" style={{ marginTop: "1rem" }}>
              <span className="label">LB pair address</span>
              <strong className="mono">{shownPair}</strong>
              <div className="actions">
                <a
                  className="ghost"
                  style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                  href={`https://devnet.meteora.ag/dlmm/${shownPair}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open on Meteora
                </a>
                <a
                  className="ghost"
                  style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                  href={`https://explorer.solana.com/address/${shownPair}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on explorer
                </a>
              </div>
              <p className="fine">
                This pool is live and wired into the dashboard Trade card. Adding
                more liquidity below opens a second position alongside any existing one.
              </p>
              <div className="actions">
                <button className="cta" onClick={() => void onSeed()} disabled={busy}>
                  {busy ? "Working…" : "Seed liquidity (10 USDC + 10 nTSLA)"}
                </button>
              </div>
              <p className="fine">
                Seeds a Spot position ±10 bins around the active price. Meteora&apos;s UI
                can&apos;t load these tokens, so this page does it for your Phantom to sign
                (2 approvals: bin arrays, then position).
              </p>
            </div>
          ) : null}
        </div>
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      </div>
    </main>
  );
}

function resolveDLMM(mod: unknown): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCustomizablePermissionlessLbPairIfExists: (...args: any[]) => Promise<PublicKey | null>;
  getBinIdFromPrice: (price: number, binStep: number, min: boolean) => number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createCustomizablePermissionlessLbPair2: (...args: any[]) => Promise<import("@solana/web3.js").Transaction>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create: (...args: any[]) => Promise<any>;
} {
  const m = mod as Record<string, unknown>;
  const cls = (m.default ?? m.DLMM) as never;
  if (!cls) throw new Error("DLMM SDK failed to load. Refresh and try again.");
  return cls as never;
}

function deriveAddressesSafe(): string {
  try {
    return deriveAddresses().receiptMint.toBase58();
  } catch {
    return "not configured";
  }
}

function shortKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 4)}...${key.slice(-4)}` : key;
}
