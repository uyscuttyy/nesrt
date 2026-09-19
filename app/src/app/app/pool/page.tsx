"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import BN from "bn.js";
import { TSLAX_MINT } from "../../../config";
import { deriveAddresses } from "../../../vault";
import { friendlyError } from "../../../errors";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import ThemeToggle from "@/components/ThemeToggle";
import { ToastStack, useToasts } from "@/components/Toasts";

const BIN_STEP = 25;
const FEE_BPS = 25; // 0.25%
const TARGET_PRICE = 1.0; // 1 nTSLA = 1 USDC
const PAIR_KEY = "nesrt-lb-pair";

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
        const found = await DLMM.getCustomizablePermissionlessLbPairIfExists(
          connection,
          mints[0],
          mints[1],
          { cluster: "devnet" } as never
        );
        setExistingPair(found ? found.toBase58() : null);
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
      if (already) {
        setExistingPair(already.toBase58());
        setNote("Pool already exists — no need to create it.");
        return;
      }
      const activeId = DLMM.getBinIdFromPrice(TARGET_PRICE, BIN_STEP, false);
      // Activation must lie in the future at execution time (slots ~400ms).
      const slot = (await connection.getSlot("confirmed")) + 300;
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
      await connection.confirmTransaction(sig, "confirmed");
      const pair = await DLMM.getCustomizablePermissionlessLbPairIfExists(
        connection,
        mints[0],
        mints[1],
        { cluster: "devnet" } as never
      );
      const addr = pair ? pair.toBase58() : "";
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
      setNote(`Failed: ${raw.slice(0, 300)}${stack ? ` — ${stack}` : ""}`);
      push(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const shownPair = createdPair ?? existingPair;

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

      <h1>Liquidity pool</h1>
      <p className="muted">
        Creates the nTSLA/USDC DLMM pool with a custom 0.25% fee. Meteora&apos;s UI only offers a
        10% tier for unverified devnet tokens, so this page builds that transaction for your
        Phantom to sign. Add liquidity afterwards on the pool&apos;s Meteora page.
      </p>

      {!connected ? (
        <p className="muted">Connect Phantom to continue.</p>
      ) : (
        <div>
          <div className="cards">
            <div className="card">
              <span className="label">Base token (nTSLA)</span>
              <strong className="mono">{shortKey(deriveAddressesSafe())}</strong>
            </div>
            <div className="card">
              <span className="label">Quote token (your USDC)</span>
              <strong className="mono">{quote ? `${shortKey(quote.mint)} · ${quote.amountUi}` : scanning ? "scanning…" : "—"}</strong>
              <span className="fine">Auto-detected from your wallet (excludes TSLAx/nTSLA).</span>
            </div>
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
              <span className="label">LB pair address</span>
              <strong className="mono">{shownPair}</strong>
              <div className="actions">
                <a
                  className="ghost"
                  style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                  href={`https://app.meteora.ag/dlmm/${shownPair}?cluster=devnet`}
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
                Next: add liquidity (e.g. 10 nTSLA + 10 USDC) on the Meteora pool page, then send
                this address to the team to wire into the dashboard.
              </p>
            </div>
          ) : null}
        </div>
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </main>
  );
}

function resolveDLMM(mod: unknown): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCustomizablePermissionlessLbPairIfExists: (...args: any[]) => Promise<{ toBase58: () => string } | null>;
  getBinIdFromPrice: (price: number, binStep: number, min: boolean) => number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createCustomizablePermissionlessLbPair2: (...args: any[]) => Promise<import("@solana/web3.js").Transaction>;
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
