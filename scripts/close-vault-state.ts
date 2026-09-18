#!/usr/bin/env node
import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction, TransactionInstruction } from "@solana/web3.js";
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

// VaultState PDA
const [vaultStatePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault-v2"), TSLAX_MINT.toBuffer()],
  VAULT_PROGRAM_ID
);

console.log("Admin:", admin.publicKey.toBase58());
console.log("Vault Program:", VAULT_PROGRAM_ID.toBase58());
console.log("VaultState PDA:", vaultStatePda.toBase58());

// close_vault_state_v2 discriminator
const closeDisc = Buffer.from(crypto.createHash("sha256").update("global:close_vault_state_v2").digest().slice(0, 8));
console.log("Close discriminator:", Array.from(closeDisc));

const ix = new TransactionInstruction({
  programId: VAULT_PROGRAM_ID,
  keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: vaultStatePda, isSigner: false, isWritable: true },
    { pubkey: TSLAX_MINT, isSigner: false, isWritable: false },
  ],
  data: closeDisc,
});

async function main() {
  const tx = new Transaction().add(ix);
  console.log("Sending close transaction...");
  const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
  console.log("Transaction signature:", sig);
  console.log("VaultState closed successfully!");
}

main().catch(console.error);