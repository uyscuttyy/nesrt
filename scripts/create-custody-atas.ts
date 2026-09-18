#!/usr/bin/env node
import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import fs from "fs";

const RPC_URL = "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

// Load admin keypair
const adminSecret = JSON.parse(fs.readFileSync("/home/uyscutty/projects/nesrt/keypairs/nesrt-admin.json", "utf-8"));
const admin = Keypair.fromSecretKey(new Uint8Array(adminSecret));

// Constants
const TSLAX_MINT = new PublicKey("4Dimn4s78herJKGhD3oxMMGbZcjirgwt376tdjq4HevA");
const VAULT_PROGRAM_ID = new PublicKey("DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB");
const MOCK_LENDER_SHARES_MINT = new PublicKey("6s2qM9MbCgcZzfdEmYt9PnvoYLpuF91PGCZ3T5noquAg");

// PDAs
const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault-v2-authority"), TSLAX_MINT.toBuffer()],
  VAULT_PROGRAM_ID
);

console.log("Admin:", admin.publicKey.toBase58());
console.log("Vault Authority PDA:", vaultAuthorityPda.toBase58());
console.log("TSLAx Mint:", TSLAX_MINT.toBase58());
console.log("Mock Lender Shares Mint:", MOCK_LENDER_SHARES_MINT.toBase58());

// Create vault TSLAx ATA (owned by vault authority)
const vaultTslaxAta = getAssociatedTokenAddressSync(TSLAX_MINT, vaultAuthorityPda, true);
console.log("Vault TSLAx ATA:", vaultTslaxAta.toBase58());

// Create vault shares (cToken) ATA (owned by vault authority)
const vaultSharesAta = getAssociatedTokenAddressSync(MOCK_LENDER_SHARES_MINT, vaultAuthorityPda, true);
console.log("Vault Shares ATA:", vaultSharesAta.toBase58());

async function main() {
  const tx = new Transaction();
  
  // Check if vault TSLAx ATA exists
  const vaultTslaxInfo = await connection.getAccountInfo(vaultTslaxAta);
  if (!vaultTslaxInfo) {
    console.log("Creating vault TSLAx ATA...");
    tx.add(createAssociatedTokenAccountInstruction(
      admin.publicKey,
      vaultTslaxAta,
      vaultAuthorityPda,
      TSLAX_MINT
    ));
  } else {
    console.log("Vault TSLAx ATA already exists");
  }
  
  // Check if vault shares ATA exists
  const vaultSharesInfo = await connection.getAccountInfo(vaultSharesAta);
  if (!vaultSharesInfo) {
    console.log("Creating vault shares ATA...");
    tx.add(createAssociatedTokenAccountInstruction(
      admin.publicKey,
      vaultSharesAta,
      vaultAuthorityPda,
      MOCK_LENDER_SHARES_MINT
    ));
  } else {
    console.log("Vault shares ATA already exists");
  }
  
  if (tx.instructions.length > 0) {
    console.log("Sending transaction...");
    const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
    console.log("Transaction signature:", sig);
    console.log("Custody ATAs created successfully!");
  } else {
    console.log("All custody ATAs already exist");
  }
}

main().catch(console.error);