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

// Mock Lender addresses (from pool init)
const MOCK_LENDER_POOL = new PublicKey("6TdFhCAHbod21bm7BCenz3fEAgfTQr1BGri7Mzjie9Nx");
const MOCK_LENDER_SHARES_MINT = new PublicKey("6s2qM9MbCgcZzfdEmYt9PnvoYLpuF91PGCZ3T5noquAg");

// Pyth feed (existing)
const PYTH_FEED = new PublicKey("FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9");

// VaultState PDA
const [vaultStatePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault-v2"), TSLAX_MINT.toBuffer()],
  VAULT_PROGRAM_ID
);

console.log("Admin:", admin.publicKey.toBase58());
console.log("Vault Program:", VAULT_PROGRAM_ID.toBase58());
console.log("VaultState PDA:", vaultStatePda.toBase58());
console.log("Mock Lender Pool:", MOCK_LENDER_POOL.toBase58());
console.log("Mock Lender Shares Mint:", MOCK_LENDER_SHARES_MINT.toBase58());

// update_kamino_config discriminator
const updateDisc = Buffer.from(crypto.createHash("sha256").update("global:update_kamino_config").digest().slice(0, 8));
console.log("Update discriminator:", Array.from(updateDisc));

// Encode new addresses (all Pubkey = 32 bytes each)
const newMarket = MOCK_LENDER_POOL.toBuffer();
const newReserve = MOCK_LENDER_POOL.toBuffer(); // pool acts as reserve
const newCtokenMint = MOCK_LENDER_SHARES_MINT.toBuffer();
const newPythFeed = PYTH_FEED.toBuffer();

const data = Buffer.concat([updateDisc, newMarket, newReserve, newCtokenMint, newPythFeed]);

const ix = new TransactionInstruction({
  programId: VAULT_PROGRAM_ID,
  keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: vaultStatePda, isSigner: false, isWritable: true },
    { pubkey: TSLAX_MINT, isSigner: false, isWritable: false },
  ],
  data,
});

async function main() {
  const tx = new Transaction().add(ix);
  console.log("Sending transaction...");
  const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
  console.log("Transaction signature:", sig);
  console.log("Vault config updated successfully!");
}

main().catch(console.error);