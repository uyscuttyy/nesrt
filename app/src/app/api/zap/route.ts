import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

export const dynamic = "force-dynamic";

/**
 * Devnet zap mint (faucet-rate, NOT a market):
 * - SOL  -> TSLAx at 1 SOL = 10 TSLAx
 * - USDC -> TSLAx at 1 USDC = 1 TSLAx
 * On mainnet this step is replaced by a real Jupiter swap; on devnet TSLAx
 * has zero liquidity anywhere, so the protocol mints at a labeled fixed rate.
 */
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const RATE_SOL_NUM = 10n; // 10 TSLAx (base units below) per 1 SOL
const RATE_SOL_DEN = BigInt(LAMPORTS_PER_SOL);
const TSLAX_DECIMALS = 6;

const seenSigs = new Set<string>();

function zapKeypair(): Keypair {
  const raw = process.env.TSLAX_FAUCET_KEYPAIR;
  if (!raw) throw new Error("Zap is not configured on this deployment.");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

function rpc(): Connection {
  return new Connection(
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    "confirmed"
  );
}

/** Current devnet zap rates (fixed, labeled, not market prices). */
export async function GET() {
  const zap = zapKeypair();
  const usdcMint = new PublicKey(DEVNET_USDC_MINT);
  return NextResponse.json({
    source: "devnet-faucet-rate",
    treasury: zap.publicKey.toBase58(),
    treasuryUsdcAta: getAssociatedTokenAddressSync(usdcMint, zap.publicKey).toBase58(),
    usdcMint: DEVNET_USDC_MINT,
    rates: [
      { input: "SOL", inputMint: "So11111111111111111111111111111111111111112", outputPerUnit: 10, outputMint: process.env.NEXT_PUBLIC_TSLAX_MINT ?? "" },
      { input: "USDC", inputMint: DEVNET_USDC_MINT, outputPerUnit: 1, outputMint: process.env.NEXT_PUBLIC_TSLAX_MINT ?? "" },
    ],
    note: "Fixed devnet rates. Mainnet uses live Jupiter quotes.",
  });
}

/**
 * Verify a SOL/USDC payment to the zap treasury, then mint TSLAx.
 * Body: { owner, token: "SOL" | "USDC", amountBase: string, paymentSig }.
 */
export async function POST(req: Request) {
  try {
    const { owner, token, amountBase, paymentSig } = (await req.json()) as {
      owner?: string;
      token?: string;
      amountBase?: string;
      paymentSig?: string;
    };
    if (!owner || (token !== "SOL" && token !== "USDC") || !amountBase || !paymentSig) {
      return NextResponse.json({ error: "Missing owner, token, amountBase or paymentSig." }, { status: 400 });
    }
    if (seenSigs.has(paymentSig)) {
      return NextResponse.json({ error: "Payment already consumed." }, { status: 409 });
    }
    const amount = BigInt(amountBase);
    if (amount <= 0n) return NextResponse.json({ error: "Amount must be positive." }, { status: 400 });

    const connection = rpc();
    const zap = zapKeypair();
    const ownerKey = new PublicKey(owner);
    const tslaxMint = new PublicKey(process.env.NEXT_PUBLIC_TSLAX_MINT ?? "");
    const slot = await connection.getSlot("confirmed");

    // Verify the payment on-chain.
    let tx;
    try {
      tx = await connection.getTransaction(paymentSig, {
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      tx = null;
    }
    if (!tx || tx.meta?.err) {
      return NextResponse.json({ error: "Payment transaction not found or failed." }, { status: 400 });
    }
    if ((tx.slot ?? 0) < slot - 450) {
      return NextResponse.json({ error: "Payment too old (expired). Make a fresh one." }, { status: 400 });
    }
    const keys = tx.transaction.message.staticAccountKeys ?? [];
    const pre = tx.meta?.preBalances ?? [];
    const post = tx.meta?.postBalances ?? [];
    const idx = (k: PublicKey) => keys.findIndex((a) => a.equals(k));
    let paidOk = false;
    if (token === "SOL") {
      const from = idx(ownerKey);
      const to = idx(zap.publicKey);
      if (from >= 0 && to >= 0) {
        const spent = BigInt(pre[from] ?? 0) - BigInt(post[from] ?? 0);
        const got = BigInt(post[to] ?? 0) - BigInt(pre[to] ?? 0);
        // spent includes fee (~5000 lamports); require received == amount.
        paidOk = got === amount && spent >= amount;
      }
    } else {
      const usdcMint = new PublicKey(DEVNET_USDC_MINT);
      const treasuryAta = getAssociatedTokenAddressSync(usdcMint, zap.publicKey);
      // Strict check: post-balance delta on the treasury ATA equals amount.
      const preBal = (tx.meta?.preTokenBalances ?? []).find(
        (b) => b.mint === DEVNET_USDC_MINT && keys[b.accountIndex]?.equals(treasuryAta)
      );
      const postBal = (tx.meta?.postTokenBalances ?? []).find(
        (b) => b.mint === DEVNET_USDC_MINT && keys[b.accountIndex]?.equals(treasuryAta)
      );
      const delta =
        BigInt(postBal?.uiTokenAmount.amount ?? "0") -
        BigInt(preBal?.uiTokenAmount.amount ?? "0");
      paidOk = delta === amount;
    }
    if (!paidOk) {
      return NextResponse.json({ error: "Payment verification failed." }, { status: 400 });
    }

    // Mint TSLAx at the fixed devnet rate.
    const tslaxBase =
      token === "SOL"
        ? (amount * RATE_SOL_NUM * BigInt(10 ** TSLAX_DECIMALS)) / RATE_SOL_DEN
        : amount; // 1:1 vs 6-decimal USDC
    if (tslaxBase <= 0n) return NextResponse.json({ error: "Amount too small." }, { status: 400 });

    const ata = getAssociatedTokenAddressSync(tslaxMint, ownerKey);
    const mintTx = new Transaction();
    if (!(await connection.getAccountInfo(ata))) {
      mintTx.add(
        createAssociatedTokenAccountInstruction(zap.publicKey, ata, ownerKey, tslaxMint)
      );
    }
    mintTx.add(
      createMintToInstruction(tslaxMint, ata, zap.publicKey, tslaxBase)
    );
    mintTx.feePayer = zap.publicKey;
    mintTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    mintTx.sign(zap);
    const mintSig = await connection.sendRawTransaction(mintTx.serialize());
    await connection.confirmTransaction(mintSig, "confirmed");
    seenSigs.add(paymentSig);
    return NextResponse.json({
      mintSig,
      tslaxBase: tslaxBase.toString(),
      rate: token === "SOL" ? "1 SOL = 10 TSLAx (devnet)" : "1 USDC = 1 TSLAx (devnet)",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Zap failed.";
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 });
  }
}
