"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useState } from "react";
import { TSLAX_MINT } from "../config";
import { friendlyError } from "../errors";
import { buildDepositTx } from "../vault";
import { fetchAndBuildPriceUpdate } from "../pyth";
import { recordFlow } from "../flows";

export type ZapToken = "SOL" | "USDC";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUP_QUOTE_URL = "https://quote-api.jup.ag/v6/quote";
const JUP_SWAP_URL = "https://quote-api.jup.ag/v6/swap";

type ZapQuote =
  | { source: "jupiter"; outBase: bigint; routeLabel: string; quoteResponse: unknown }
  | { source: "devnet"; outBase: bigint; routeLabel: string };

/**
 * 1-click Zap-In: SOL/USDC -> TSLAx -> vaulted nTSLA.
 * Primary path is a live Jupiter v6 quote+swap; on devnet (where TSLAx has
 * no liquidity and Jupiter returns no route) it falls back to the labeled
 * devnet faucet-rate mint via /api/zap. Executes bundled when it fits,
 * otherwise sequential swap-then-deposit.
 */
export default function JupiterZapModal({ onDone }: { onDone?: () => void }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [token, setToken] = useState<ZapToken>("SOL");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<ZapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const decimals = token === "SOL" ? 9 : 6;

  async function refreshQuote(nextToken: ZapToken, nextAmount: string) {
    setQuote(null);
    setError("");
    const parsed = Number(nextAmount);
    if (!publicKey || !Number.isFinite(parsed) || parsed <= 0) return;
    const inputMint = nextToken === "SOL" ? SOL_MINT : await usdcMint();
    if (!inputMint) return;
    const inBase = BigInt(Math.floor(parsed * 10 ** decimals));
    setQuoting(true);
    try {
      // 1) Live Jupiter quote (works wherever routes exist). Network failure
      // must NOT skip the devnet fallback below.
      try {
        const q = await fetch(
          `${JUP_QUOTE_URL}?inputMint=${inputMint}&outputMint=${TSLAX_MINT}&amount=${inBase.toString()}&slippageBps=100`
        );
        if (q.ok) {
          const body = (await q.json()) as {
            outAmount?: string;
            routePlan?: unknown[];
          };
          if (body.routePlan?.length && body.outAmount) {
            setQuote({
              source: "jupiter",
              outBase: BigInt(body.outAmount),
              routeLabel: `Jupiter · ${(Number(body.outAmount) / 1e6).toFixed(4)} TSLAx`,
              quoteResponse: body,
            });
            return;
          }
        }
      } catch {
        /* Jupiter unreachable — devnet fallback below */
      }
      // 2) Devnet fallback: fixed faucet rate.
      const r = await fetch("/api/zap");
      if (!r.ok) throw new Error("Zap service unavailable.");
      const rates = (await r.json()) as { source: string };
      void rates;
      const outBase =
        nextToken === "SOL"
          ? (inBase * 10n * BigInt(10 ** 6)) / BigInt(LAMPORTS_PER_SOL)
          : inBase;
      if (outBase <= 0n) throw new Error("Amount too small.");
      setQuote({
        source: "devnet",
        outBase,
        routeLabel: `Devnet faucet rate · ${(Number(outBase) / 1e6).toFixed(4)} TSLAx`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 160) : "Quote failed.");
    } finally {
      setQuoting(false);
    }
  }

  async function usdcMint(): Promise<string | null> {
    try {
      const r = await fetch("/api/zap");
      if (!r.ok) return null;
      const body = (await r.json()) as { usdcMint?: string };
      return body.usdcMint ?? null;
    } catch {
      return null;
    }
  }

  function pick(t: ZapToken) {
    setToken(t);
    void refreshQuote(t, amount);
  }

  function typeAmount(v: string) {
    setAmount(v);
    void refreshQuote(token, v);
  }

  async function onZap() {
    if (!publicKey || !quote) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setBusy(true);
    setError("");
    try {
      if (quote.source === "jupiter") {
        await zapViaJupiter(parsed);
      } else {
        await zapViaDevnet(parsed);
      }
      setAmount("");
      setQuote(null);
      onDone?.();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function jupiterSwapTx(): Promise<VersionedTransaction> {
    const q = quote;
    if (!q || q.source !== "jupiter" || !publicKey) throw new Error("No Jupiter route.");
    const res = await fetch(JUP_SWAP_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse: q.quoteResponse,
        userPublicKey: publicKey.toBase58(),
        wrapAndUnwrapSol: true,
      }),
    });
    if (!res.ok) throw new Error("Jupiter swap build failed.");
    const body = (await res.json()) as { swapTransaction?: string };
    if (!body.swapTransaction) throw new Error("Jupiter returned no transaction.");
    return VersionedTransaction.deserialize(Buffer.from(body.swapTransaction, "base64"));
  }

  async function depositTxFor(user: PublicKey, tslaxBase: bigint) {
    const posted = await fetchAndBuildPriceUpdate(user).catch(() => null);
    const { tx, extraSigners } = await buildDepositTx(
      connection,
      user,
      tslaxBase,
      posted ?? undefined
    );
    return { tx, extraSigners };
  }

  async function tslaxBalance(user: PublicKey): Promise<bigint> {
    const ata = getAssociatedTokenAddressSync(new PublicKey(TSLAX_MINT), user);
    const acc = await connection.getTokenAccountBalance(ata).catch(() => null);
    return acc ? BigInt(acc.value.amount) : 0n;
  }

  /** Bundle attempt: append deposit ix to the Jupiter swap tx when it fits. */
  async function zapViaJupiter(parsed: number) {
    if (!publicKey) return;
    void parsed;
    if (!quote || quote.source !== "jupiter") throw new Error("No Jupiter route.");
    const quotedOut = quote.outBase;
    setStatus("Swapping via Jupiter… (approve in Phantom)");
    const before = await tslaxBalance(publicKey);
    const swapTx = await jupiterSwapTx();
    const sendDeposit = async (tslaxBase: bigint, label: string) => {
      if (tslaxBase <= 0n) throw new Error("Swap yielded no TSLAx.");
      const { tx: dtx, extraSigners: ds } = await depositTxFor(publicKey, tslaxBase);
      const sig = await sendTransaction(
        dtx,
        connection,
        ds.length > 0 ? { signers: ds } : undefined
      );
      await connection.confirmTransaction(sig, "confirmed");
      setStatus(`${label} ${sig.slice(0, 8)}…`);
    };
    try {
      const { tx: depositTx, extraSigners } = await depositTxFor(publicKey, quotedOut);
      void extraSigners;
      const [depositIx] = depositTx.instructions;
      const { TransactionMessage, VersionedTransaction: VT } = await import("@solana/web3.js");
      const msg = TransactionMessage.decompile(swapTx.message);
      msg.instructions.push(depositIx);
      const bundled = new VT(msg.compileToV0Message());
      if (bundled.serialize().length > 1200) throw new Error("too large");
      setStatus("Sending zap + deposit as one atomic transaction…");
      const sig = await sendTransaction(bundled, connection);
      await connection.confirmTransaction(sig, "confirmed");
      recordFlow(publicKey.toBase58(), "in", quotedOut);
      setStatus(`Zapped & deposited. ${sig.slice(0, 8)}…`);
      return;
    } catch {
      // Sequential fallback: swap, confirm, then auto-deposit actual delta.
    }
    setStatus("Sending swap first…");
    const sig1 = await sendTransaction(swapTx, connection);
    await connection.confirmTransaction(sig1, "confirmed");
    setStatus("Swap confirmed. Depositing into vault… (approve)");
    const acquired = (await tslaxBalance(publicKey)) - before;
    await sendDeposit(acquired, "Zapped & deposited.");
    recordFlow(publicKey.toBase58(), "in", acquired > 0n ? acquired : 0n);
  }

  async function zapViaDevnet(parsed: number) {
    if (!publicKey) return;
    const inBase = BigInt(Math.floor(parsed * 10 ** decimals));
    // Step 1: pay treasury.
    setStatus(`Paying ${parsed} ${token} to zap treasury… (approve in Phantom)`);
    const r = await fetch("/api/zap");
    if (!r.ok) throw new Error("Zap service unavailable.");
    const cfg = (await r.json()) as { treasury: string; treasuryUsdcAta: string; usdcMint: string };
    const treasury = new PublicKey(cfg.treasury);
    const payTx = new Transaction();
    if (token === "SOL") {
      payTx.add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: treasury, lamports: inBase })
      );
    } else {
      const mint = new PublicKey(cfg.usdcMint);
      const userAta = getAssociatedTokenAddressSync(mint, publicKey);
      const treasuryAta = new PublicKey(cfg.treasuryUsdcAta);
      const info = await connection.getAccountInfo(treasuryAta);
      if (!info) {
        payTx.add(
          createAssociatedTokenAccountInstruction(publicKey, treasuryAta, treasury, mint)
        );
      }
      payTx.add(
        createTransferInstruction(userAta, treasuryAta, publicKey, inBase, [], TOKEN_PROGRAM_ID)
      );
    }
    const paySig = await sendTransaction(payTx, connection);
    await connection.confirmTransaction(paySig, "confirmed");
    // Step 2: server verifies + mints TSLAx.
    setStatus("Minting TSLAx at devnet faucet rate…");
    const m = await fetch("/api/zap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        owner: publicKey.toBase58(),
        token,
        amountBase: inBase.toString(),
        paymentSig: paySig,
      }),
    });
    const mintBody = (await m.json()) as { error?: string; tslaxBase?: string };
    if (!m.ok) throw new Error(mintBody.error ?? "Zap mint failed.");
    // Step 3: auto-deposit the minted TSLAx (exact server amount).
    setStatus("Depositing into vault… (approve)");
    const { tx: dtx, extraSigners: ds } = await depositTxFor(
      publicKey,
      BigInt(mintBody.tslaxBase ?? "0")
    );
    const sig2 = await sendTransaction(
      dtx,
      connection,
      ds.length > 0 ? { signers: ds } : undefined
    );
    await connection.confirmTransaction(sig2, "confirmed");
    recordFlow(publicKey.toBase58(), "in", BigInt(mintBody.tslaxBase ?? "0"));
    setStatus(`Zapped & deposited ${(Number(mintBody.tslaxBase ?? "0") / 1e6).toFixed(4)} TSLAx. ${sig2.slice(0, 8)}…`);
  }

  return (
    <div>
      <div className="actions" style={{ marginTop: 0 }}>
        {(["SOL", "USDC"] as ZapToken[]).map((t) => (
          <button
            key={t}
            className={token === t ? "cta" : "ghost"}
            onClick={() => pick(t)}
            disabled={busy}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="actions">
        <input
          className="input"
          type="number"
          min="0"
          step="any"
          placeholder={`Amount in ${token}`}
          value={amount}
          onChange={(e) => typeAmount(e.target.value)}
          disabled={busy}
          style={{ fontSize: "1.15rem", fontWeight: 600 }}
        />
      </div>
      <div className="card" style={{ marginTop: "1rem" }}>
        <span className="label">You receive (estimate)</span>
        <strong>
          {quoting ? "Quoting…" : quote ? quote.routeLabel : "Enter an amount"}
        </strong>
        {quote?.source === "devnet" ? (
          <span className="fine">Fixed devnet rate — mainnet uses live Jupiter quotes.</span>
        ) : quote ? (
          <span className="fine">Live Jupiter v6 route.</span>
        ) : null}
      </div>
      <div className="actions">
        <button className="cta" onClick={() => void onZap()} disabled={busy || !quote}>
          {busy ? "Working…" : "Zap & Deposit"}
        </button>
      </div>
      {status ? <p className="fine">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
