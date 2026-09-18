#!/usr/bin/env node
import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import fs from "fs";
import crypto from "crypto";

const RPC_URL = "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

// Load admin keypair
const adminSecret = JSON.parse(fs.readFileSync("/home/uyscutty/projects/nesrt/keypairs/nesrt-admin.json", "utf-8"));
const admin = Keypair.fromSecretKey(new Uint8Array(adminSecret));

// Constants
const TSLAX_MINT = new PublicKey("4Dimn4s78herJKGhD3oxMMGbZcjirgwt376tdjq4HevA");
const VAULT_PROGRAM_ID = new PublicKey("DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB");

// PDAs
const [vaultStatePda, stateBump] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault-v2"), TSLAX_MINT.toBuffer()],
  VAULT_PROGRAM_ID
);

const [vaultAuthorityPda, authBump] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault-v2-authority"), TSLAX_MINT.toBuffer()],
  VAULT_PROGRAM_ID
);

const [receiptMintPda, receiptBump] = PublicKey.findProgramAddressSync(
  [Buffer.from("receipt"), TSLAX_MINT.toBuffer()],
  VAULT_PROGRAM_ID
);

const [vaultTslaxPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault-v2-tslax"), TSLAX_MINT.toBuffer()],
  VAULT_PROGRAM_ID
);

const [vaultCtokenPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault-v2-ctoken"), TSLAX_MINT.toBuffer()],
  VAULT_PROGRAM_ID
);

console.log("Admin:", admin.publicKey.toBase58());
console.log("Vault Program:", VAULT_PROGRAM_ID.toBase58());
console.log("VaultState PDA:", vaultStatePda.toBase58());
console.log("Vault Authority PDA:", vaultAuthorityPda.toBase58());
console.log("Receipt Mint PDA:", receiptMintPda.toBase58());
console.log("Vault TSLAx PDA:", vaultTslaxPda.toBase58());
console.log("Vault cToken PDA:", vaultCtokenPda.toBase58());

// initialize_mint discriminator
const initMintDisc = Buffer.from(crypto.createHash("sha256").update("global:initialize_mint").digest().slice(0, 8));
console.log("Initialize Mint discriminator:", Array.from(initMintDisc));

const ix1 = new TransactionInstruction({
  programId: VAULT_PROGRAM_ID,
  keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: vaultStatePda, isSigner: false, isWritable: false },
    { pubkey: vaultAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: receiptMintPda, isSigner: false, isWritable: true },
    { pubkey: TSLAX_MINT, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ],
  data: initMintDisc,
});

// init_custody discriminator
const initCustodyDisc = Buffer.from(crypto.createHash("sha256").update("global:init_custody").digest().slice(0, 8));
console.log("Init Custody discriminator:", Array.from(initCustodyDisc));

const ix2 = new TransactionInstruction({
  programId: VAULT_PROGRAM_ID,
  keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: vaultStatePda, isSigner: false, isWritable: false },
    { pubkey: vaultAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: vaultTslaxPda, isSigner: false, isWritable: true },
    { pubkey: vaultCtokenPda, isSigner: false, isWritable: true },
    { pubkey: TSLAX_MINT, isSigner: false, isWritable: false },
    { pubkey: receiptMintPda, isSigner: false, isWritable: false }, // This is the ctoken mint in the old layout but we use mock_lender shares mint
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ],
  data: initCustodyDisc,
});

async function main() {
  const tx = new Transaction().add(ix1, ix2);
  console.log("Sending initialize mint + custody transaction...");
  const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
  console.log("Transaction signature:", sig);
  console.log("Mint and custody initialized successfully!");
}

main().catch(console.error);