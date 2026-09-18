#!/usr/bin/env node
import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createInitializeMintInstruction, MINT_SIZE, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import fs from "fs";
import crypto from "crypto";

const RPC_URL = "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

// Load admin keypair
const adminSecret = JSON.parse(fs.readFileSync("/home/uyscutty/projects/nesrt/keypairs/nesrt-admin.json", "utf-8"));
const admin = Keypair.fromSecretKey(new Uint8Array(adminSecret));

// Constants
const TSLAX_MINT = new PublicKey("4Dimn4s78herJKGhD3oxMMGbZcjirgwt376tdjq4HevA");
const MOCK_LENDER_PROGRAM_ID = new PublicKey("7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g");

// PDAs
const [poolPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("pool"), TSLAX_MINT.toBuffer()],
  MOCK_LENDER_PROGRAM_ID
);

const [sharesMintPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("shares"), TSLAX_MINT.toBuffer()],
  MOCK_LENDER_PROGRAM_ID
);

// Pool vault (ATA owned by pool PDA)
const poolVault = getAssociatedTokenAddressSync(TSLAX_MINT, poolPda, true);

console.log("Admin:", admin.publicKey.toBase58());
console.log("TSLAx Mint:", TSLAX_MINT.toBase58());
console.log("Mock Lender Program:", MOCK_LENDER_PROGRAM_ID.toBase58());
console.log("Pool PDA:", poolPda.toBase58());
console.log("Shares Mint PDA:", sharesMintPda.toBase58());
console.log("Pool Vault (ATA):", poolVault.toBase58());

// Initialize pool instruction
const initDisc = Buffer.from(crypto.createHash("sha256").update("global:initialize_pool").digest().slice(0, 8));
console.log("Initialize discriminator:", Array.from(initDisc));

const ix = new TransactionInstruction({
  programId: MOCK_LENDER_PROGRAM_ID,
  keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: TSLAX_MINT, isSigner: false, isWritable: false },
    { pubkey: poolPda, isSigner: false, isWritable: true },
    { pubkey: poolVault, isSigner: false, isWritable: true },
    { pubkey: sharesMintPda, isSigner: false, isWritable: true },
    { pubkey: poolPda, isSigner: false, isWritable: false }, // pool_authority
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ],
  data: initDisc,
});

async function main() {
  const tx = new Transaction().add(ix);

  console.log("Sending transaction...");
  const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
  console.log("Transaction signature:", sig);
  console.log("Pool initialized successfully!");
}

main().catch(console.error);