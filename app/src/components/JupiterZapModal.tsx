"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
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
export default function JupiterZapModal({
  onDone,
  slippageBps = 100,
}: {
  onDone?: () => void;
  slippageBps?: number;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [token, setToken] = useState<ZapToken>("SOL");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<ZapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [slippage, setSlippage] = useState(slippageBps);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const decimals = token === "SOL" ? 9 : 6;

  async function refreshQuote(nextToken: ZapToken, nextAmount: string, nextSlippage: number) {
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
          `${JUP_QUOTE_URL}?inputMint=${inputMint}&outputMint=${TSLAX_MINT}&amount=${inBase.toString()}&slippageBps=${nextSlippage}`
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
    void refreshQuote(t, amount, slippage);
  }

  function typeAmount(v: string) {
    setAmount(v);
    void refreshQuote(token, v, slippage);
  }

  function pickSlippage(bps: number) {
    setSlippage(bps);
    void refreshQuote(token, amount, bps);
  }

  async function onZap() {
    if (!publicKey || !quote) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    // Precheck balances before any signature, so failures name the cause.
    try {
      if (token === "SOL") {
        const sol = await connection.getBalance(publicKey);
        const need = Math.floor(parsed * LAMPORTS_PER_SOL) + 20_000;
        if (sol < need) {
          setError(`Insufficient SOL: need ~${(need / LAMPORTS_PER_SOL).toFixed(4)} (amount + fees), wallet has ${(sol / LAMPORTS_PER_SOL).toFixed(4)}.`);
          return;
        }
      } else {
        const mint = new PublicKey((await usdcMint()) ?? "");
        const ata = getAssociatedTokenAddressSync(mint, publicKey);
        const acc = await connection.getTokenAccountBalance(ata).catch(() => null);
        const has = acc ? Number(acc.value.amount) / 10 ** decimals : 0;
        if (has < parsed) {
          setError(`Insufficient USDC: need ${parsed}, wallet has ${has.toFixed(4)}.`);
          return;
        }
      }
    } catch (e) {
      setError(`Balance check failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
      return;
    }
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

  /** Wallet signing wrapper that names the failing step (wallet errors are opaque).
   * NOTE: no pre-simulation — connection.simulateTransaction throws
   * "Invalid arguments" for these txs in this environment (proven headlessly),
   * which masked every real error. Chain + server verification remain. */
  async function signSend(
    step: string,
    tx: Transaction | VersionedTransaction,
    signers?: import("@solana/web3.js").Signer[]
  ): Promise<string> {
    let sent = false;
    try {
      const sig = await sendTransaction(
        tx,
        connection,
        signers && signers.length > 0 ? { signers } : undefined
      );
      sent = true;
      await confirmSig(sig);
      return sig;
    } catch (e) {
      const name = e instanceof Error ? e.name : typeof e;
      const code = (e as { code?: unknown })?.code;
      const raw = e instanceof Error ? e.message : String(e);
      console.error(`[zap:${step}]`, e);
      throw new Error(
        `${step} failed${sent ? " after signing" : " before signing"} [${name}${code !== undefined ? `/${String(code)}` : ""}]: ${raw.slice(0, 140)}`
      );
    }
  }

  /**
   * Confirmation with a timeout. Devnet RPC websockets stall: if the wait
   * exceeds 30s, check the signature status directly instead of hanging
   * forever with a spinner and no error.
   */
  async function confirmSig(sig: string): Promise<void> {
    const wait = connection.confirmTransaction(sig, "confirmed").then(() => true);
    const timeout = new Promise<false>((r) => setTimeout(() => r(false), 30_000));
    if (await Promise.race([wait, timeout])) return;
    const st = await connection.getSignatureStatus(sig).catch(() => null);
    const status = st?.value;
    if (
      status &&
      (status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized")
    ) {
      return;
    }
    if (status?.err) throw new Error(`transaction failed on-chain: ${JSON.stringify(status.err)}`);
    throw new Error("confirmation timed out — check the explorer; do not retry blindly (see history).");
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
      dtx.feePayer = publicKey;
      dtx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const sig = await signSend("Vault deposit signature", dtx, ds);
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
      const sig = await signSend("Zap + deposit signature", bundled);
      recordFlow(publicKey.toBase58(), "in", quotedOut);
      setStatus(`Zapped & deposited. ${sig.slice(0, 8)}…`);
      return;
    } catch {
      // Sequential fallback: swap, confirm, then auto-deposit actual delta.
    }
    setStatus("Sending swap first…");
    const sig1 = await signSend("Swap signature", swapTx);
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
    let payTx: Transaction;
    try {
      const r = await fetch("/api/zap");
      if (!r.ok) throw new Error("Zap service unavailable.");
      const cfg = (await r.json()) as { treasury: string; treasuryUsdcAta: string; usdcMint: string };
      const treasury = new PublicKey(cfg.treasury);
      payTx = new Transaction();
      if (token === "SOL") {
        payTx.add(
          SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: treasury, lamports: inBase })
        );
      } else {
        const mint = new PublicKey(cfg.usdcMint);
        const userAta = getAssociatedTokenAddressSync(mint, publicKey);
        const treasuryAta = new PublicKey(cfg.treasuryUsdcAta);
        // Idempotent create: no existence pre-check RPC that can misfire.
        payTx.add(
          createAssociatedTokenAccountIdempotentInstruction(publicKey, treasuryAta, treasury, mint)
        );
        payTx.add(
          createTransferInstruction(userAta, treasuryAta, publicKey, inBase, [], TOKEN_PROGRAM_ID)
        );
      }
      // Explicit payer + blockhash: the adapter throws opaquely when it must
      // prepare these itself on multi-instruction token txs.
      payTx.feePayer = publicKey;
      payTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      throw new Error(`${token} payment build failed: ${raw.slice(0, 160)}`);
    }
    const paySig = await signSend(`${token} payment signature`, payTx);
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
    dtx.feePayer = publicKey;
    dtx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const sig2 = await signSend("Vault deposit signature", dtx, ds);
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
        <span className="fine" style={{ marginLeft: "auto" }}>
          Slippage:&nbsp;
          {[50, 100, 200].map((bps) => (
            <button
              key={bps}
              className={slippage === bps ? "tab tab-active" : "tab"}
              style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}
              onClick={() => pickSlippage(bps)}
              disabled={busy}
            >
              {(bps / 100).toFixed(1)}%
            </button>
          ))}
        </span>
      </div>
      <div className="actions actions-centered">
        <input
          className="input"
          type="number"
          min="0"
          onWheel={(e) => e.currentTarget.blur()}
          step="any"
          placeholder={`Amount in ${token}`}
          value={amount}
          onChange={(e) => typeAmount(e.target.value)}
          disabled={busy}
          style={{ fontSize: "1.15rem", fontWeight: 600, maxWidth: "22rem", textAlign: "center" }}
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
      <div className="actions actions-centered">
        <button className="cta" onClick={() => void onZap()} disabled={busy || !quote}>
          {busy ? "Working…" : "Zap & Deposit"}
        </button>
      </div>
      {status ? <p className="fine">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
