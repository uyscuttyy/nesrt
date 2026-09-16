import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const AMOUNT_BASE = 100_000_000; // 100 TSLAx, 6 decimals

function faucetKeypair(): Keypair {
  const raw = process.env.TSLAX_FAUCET_KEYPAIR;
  if (!raw) throw new Error("Faucet is not configured on this deployment.");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

/** Devnet-only faucet: mints mock TSLAx to the caller's wallet. */
export async function POST(req: Request) {
  try {
    const { owner } = (await req.json()) as { owner?: string };
    if (!owner) return NextResponse.json({ error: "Missing wallet address." }, { status: 400 });
    const ownerKey = new PublicKey(owner);
    const mint = new PublicKey(process.env.NEXT_PUBLIC_TSLAX_MINT ?? "");
    const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
    const connection = new Connection(rpc, "confirmed");
    const faucet = faucetKeypair();
    const ata = getAssociatedTokenAddressSync(mint, ownerKey);
    const tx = new (await import("@solana/web3.js")).Transaction();
    if (!(await connection.getAccountInfo(ata))) {
      tx.add(createAssociatedTokenAccountInstruction(faucet.publicKey, ata, ownerKey, mint));
    }
    tx.add(createMintToInstruction(mint, ata, faucet.publicKey, AMOUNT_BASE));
    tx.feePayer = faucet.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(faucet);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    return NextResponse.json({ signature: sig });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Faucet failed.";
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 });
  }
}
