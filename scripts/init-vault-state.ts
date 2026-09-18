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

// Mock Lender addresses
const MOCK_LENDER_POOL = new PublicKey("6TdFhCAHbod21bm7BCenz3fEAgfTQr1BGri7Mzjie9Nx");
const MOCK_LENDER_SHARES_MINT = new PublicKey("6s2qM9MbCgcZzfdEmYt9PnvoYLpuF91PGCZ3T5noquAg");
const PYTH_FEED = new PublicKey("FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9");

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

console.log("Admin:", admin.publicKey.toBase58());
console.log("Vault Program:", VAULT_PROGRAM_ID.toBase58());
console.log("VaultState PDA:", vaultStatePda.toBase58(), "bump:", stateBump);
console.log("Vault Authority PDA:", vaultAuthorityPda.toBase58(), "bump:", authBump);
console.log("Receipt Mint PDA:", receiptMintPda.toBase58(), "bump:", receiptBump);
console.log("Mock Lender Pool:", MOCK_LENDER_POOL.toBase58());
console.log("Mock Lender Shares Mint:", MOCK_LENDER_SHARES_MINT.toBase58());

// initialize_state discriminator
const initDisc = Buffer.from(crypto.createHash("sha256").update("global:initialize_state").digest().slice(0, 8));
console.log("Initialize discriminator:", Array.from(initDisc));

// Build instruction data
const ix = new TransactionInstruction({
  programId: VAULT_PROGRAM_ID,
  keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: vaultStatePda, isSigner: false, isWritable: true },
    { pubkey: vaultAuthorityPda, isSigner: false, isWritable: true },
    { pubkey: receiptMintPda, isSigner: false, isWritable: true },
    { pubkey: TSLAX_MINT, isSigner: false, isWritable: false },
    { pubkey: MOCK_LENDER_POOL, isSigner: false, isWritable: false },
    { pubkey: MOCK_LENDER_SHARES_MINT, isSigner: false, isWritable: false },
    { pubkey: PYTH_FEED, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ],
  data: initDisc,
});

async function main() {
  const tx = new Transaction().add(ix);
  console.log("Sending initialize transaction...");
  const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
  console.log("Transaction signature:", sig);
  console.log("VaultState initialized successfully!");
}

main().catch(console.error);