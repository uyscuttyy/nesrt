import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config({ path: "../app/.env.local" });

const multisig = require("@sqds/multisig");

const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const SQUADS_PROGRAM_ID = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");

async function loadAdminKeypair(): Promise<Keypair> {
  const raw = JSON.parse(fs.readFileSync("../keypairs/nesrt-admin.json", "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

async function main() {
  console.log("🔧 Creating Squads V4 Multisig on Devnet...\n");

  if (!process.env.NEXT_PUBLIC_SOLANA_RPC_URL) {
    console.error("❌ Missing RPC URL");
    process.exit(1);
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const admin = await loadAdminKeypair();
  console.log("Admin wallet:", admin.publicKey.toBase58());
  console.log("");

  // Check admin balance
  const balance = await connection.getBalance(admin.publicKey);
  console.log("Admin SOL balance:", (balance / 1e9).toFixed(4), "SOL");

  // Generate a dedicated createKey for multisig PDA derivation
  const createKey = Keypair.generate();
  console.log("Create key (for multisig PDA):", createKey.publicKey.toBase58());

  // Derive multisig PDA using the createKey
  const multisigPda = multisig.getMultisigPda({
    createKey: createKey.publicKey,
    programId: SQUADS_PROGRAM_ID,
  })[0];

  console.log("Multisig PDA:", multisigPda.toBase58());

  // Check if multisig already exists
  try {
    const existing = await connection.getAccountInfo(multisigPda);
    if (existing) {
      console.log("✅ Multisig already exists at:", multisigPda.toBase58());
      console.log("View on explorer: https://explorer.solana.com/address/" + multisigPda.toBase58() + "?cluster=devnet");
      return;
    }
  } catch {
    // Not found
  }

  // Create treasury PDA for multisig
  const treasuryPda = multisig.getVaultPda({
    multisigPda,
    index: 0,
    programId: multisig.PROGRAM_ID,
  })[0];

  console.log("Treasury PDA:", treasuryPda.toBase58());

  // Create the multisig using V1 (which properly accepts createKey)
  const members = [
    { key: admin.publicKey, permissions: 1 | 2 | 4 }, // Admin has all permissions (Initiate|Vote|Execute)
    { key: PublicKey.default, permissions: 0 },
    { key: PublicKey.default, permissions: 0 },
  ];

  console.log("\n📋 Creating Squads V4 Multisig (2/3 threshold)...");
  console.log("Members:", [{ key: admin.publicKey.toBase58(), permissions: "ALL" }]);
  console.log("Threshold: 2 (will need 2 of 3 to execute)");
  console.log("Time lock: 0 seconds (no timelock for hackathon)");
  console.log("");

  // Create the multisig using V1 (which properly accepts createKey)
  const createIx = multisig.instructions.multisigCreate(
    {
      creator: admin.publicKey,
      multisigPda,
      configAuthority: admin.publicKey,
      threshold: 2,
      members: [
        { key: admin.publicKey, permissions: 1 | 2 | 4 }, // Admin has all permissions (Initiate|Vote|Execute)
        { key: PublicKey.default, permissions: 0 },
        { key: PublicKey.default, permissions: 0 },
      ],
      timeLock: 0,
      createKey: createKey.publicKey,
      memo: "Nesrt Vault Squads V4 Multisig",
    },
    SQUADS_PROGRAM_ID
  );

  // The createKey needs to sign the transaction
  console.log("\nCreating multisig...");
  console.log("Create key:", createKey.publicKey.toBase58());
  console.log("Multisig PDA:", multisigPda.toBase58());
  console.log("Treasury:", treasuryPda.toBase58());

  const tx = new Transaction().add(createIx);
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  // BOTH admin and createKey must sign
  tx.sign(admin, createKey);

  console.log("\nSending transaction...");
  const sig = await sendAndConfirmTransaction(connection, tx, [admin, createKey], { commitment: "confirmed" });

  console.log("\n✅ Multisig created successfully!");
  console.log("Transaction:", sig);
  console.log("View on explorer: https://explorer.solana.com/tx/" + sig + "?cluster=devnet");
  console.log("");
  console.log("Multisig address:", multisigPda.toBase58());
  console.log("View on Squads: https://app.squads.so/" + multisigPda.toBase58() + "?cluster=devnet");
  console.log("");
  console.log("📋 NEXT STEP: Transfer vault admin authority to this multisig");
  console.log("Run: npx tsx scripts/transfer-admin-to-multisig.ts");
  console.log("");
  console.log("Multisig address:", multisigPda.toBase58());
  console.log("Save this address for the next step!");

  // Save multisig address for next step
  fs.writeFileSync("./multisig-address.json", JSON.stringify({
    multisig: multisigPda.toBase58(),
    treasury: treasuryPda.toBase58(),
    createKey: createKey.publicKey.toBase58(),
    createdAt: new Date().toISOString(),
  }, null, 2));
  console.log("\nMultisig address saved to multisig-address.json");
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});