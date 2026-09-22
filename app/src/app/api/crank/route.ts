import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * Simulated borrow-interest crank (devnet theater, honestly labeled).
 * Drips a small fixed amount of TSLAx into the mock pool, which raises the
 * share price — the same mechanism real borrow interest would drive.
 * Rate-limited server-side (min interval); the dashboard calls it on a timer
 * while open so yield visibly ticks without manual drips.
 */
const DRIP_BASE = 50_000n; // 0.05 TSLAx per crank
const MIN_INTERVAL_MS = 5 * 60 * 1000;
let lastDripAt = 0;

function adminKeypair(): Keypair {
  const raw = process.env.TSLAX_FAUCET_KEYPAIR;
  if (!raw) throw new Error("Crank is not configured on this deployment.");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

export async function POST() {
  try {
    const now = Date.now();
    if (now - lastDripAt < MIN_INTERVAL_MS) {
      return NextResponse.json({ skipped: true, reason: "rate-limited" });
    }
    const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
    const connection = new Connection(rpc, "confirmed");
    const admin = adminKeypair();
    const tslaxMint = new PublicKey(process.env.NEXT_PUBLIC_TSLAX_MINT ?? "");
    const pool = new PublicKey(process.env.NEXT_PUBLIC_MOCK_LENDER_POOL ?? "");
    const mockProgram = new PublicKey(process.env.NEXT_PUBLIC_MOCK_LENDER_PROGRAM_ID ?? "");
    const adminTslax = getAssociatedTokenAddressSync(tslaxMint, admin.publicKey);
    const poolVault = getAssociatedTokenAddressSync(tslaxMint, pool, true);

    const disc = crypto.createHash("sha256").update("global:drip_yield").digest().subarray(0, 8);
    const amt = Buffer.alloc(8);
    amt.writeBigUInt64LE(DRIP_BASE);
    const ix = new TransactionInstruction({
      programId: mockProgram,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: tslaxMint, isSigner: false, isWritable: false },
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: adminTslax, isSigner: false, isWritable: true },
        { pubkey: poolVault, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc, amt]),
    });
    const tx = new Transaction().add(ix);
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(admin);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    lastDripAt = Date.now();
    return NextResponse.json({ signature: sig, drippedBase: DRIP_BASE.toString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Crank failed.";
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 });
  }
}
