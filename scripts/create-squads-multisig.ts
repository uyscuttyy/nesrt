import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config({ path: "../app/.env.local" });

const multisig = require("@sqds/multisig");

const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const SQUADS_PROGRAM_ID = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");

async function loadAdminKeypair(): Promise<Keypair> {
  const raw = JSON.parse(fs.readFileSync("./keypairs/nesrt-admin.json", "utf-8"));
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

  // First, fetch the programConfig to get the correct treasury PDA
  const [programConfigPda] = multisig.getProgramConfigPda({ programId: SQUADS_PROGRAM_ID });
  const programConfigAccount = await connection.getAccountInfo(programConfigPda);
  if (!programConfigAccount) {
    console.error("❌ ProgramConfig not found");
    process.exit(1);
  }

  // Parse treasury from programConfig (offset 48-80: 8 fee + 32 treasury)
  const configData = Buffer.from(programConfigAccount.data);
  const treasuryPda = new PublicKey(configData.slice(48, 80));
  console.log("Treasury PDA from programConfig:", treasuryPda.toBase58());

  // Generate a dedicated createKey for multisig PDA derivation
  const createKey = Keypair.generate();
  console.log("Create key (for multisig PDA):", createKey.publicKey.toBase58());

  // Derive multisig PDA using the createKey
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
    programId: SQUADS_PROGRAM_ID,
  });

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

  console.log("\n📋 Creating Squads V4 Multisig (1/1 threshold - admin only)...");
  console.log("Members:", [{ key: admin.publicKey.toBase58(), permissions: "ALL" }]);
  console.log("Threshold: 1 (single admin control for hackathon)");
  console.log("Time lock: 0 seconds (no timelock for hackathon)");
  console.log("");

  // Use V2 with the CORRECT treasury from programConfig
  // Use threshold 1 with just the admin as member
  const createIx = multisig.instructions.multisigCreateV2(
    {
      creator: admin.publicKey,
      multisigPda,
      configAuthority: null,
      timeLock: 0,
      treasury: treasuryPda,  // Use the treasury from programConfig!
      members: [
        { key: admin.publicKey, permissions: multisig.types.Permissions.all() }, // Admin has all permissions
      ],
      threshold: 1,  // Explicitly set threshold
      createKey: createKey.publicKey,
      memo: "Nesrt Vault Squads V4 Multisig",
    },
    SQUADS_PROGRAM_ID
  );

  // CRITICAL FIX: Force createKey at account index 3 (SDK omits it despite passing in args)
  // Account order for multisigCreateV2: [programConfig, treasury, multisig, createKey, creator, systemProgram]
  if (createIx.keys.length > 3) {
    createIx.keys[3] = { pubkey: createKey.publicKey, isSigner: true, isWritable: false };
    console.log("Patched account index 3 to createKey:", createKey.publicKey.toBase58());
  } else {
    console.error("Unexpected instruction key count:", createIx.keys.length);
    process.exit(1);
  }

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
  fs.writeFileSync("./scripts/multisig-address.json", JSON.stringify({
    multisig: multisigPda.toBase58(),
    treasury: treasuryPda.toBase58(),
    createKey: createKey.publicKey.toBase58(),
    createdAt: new Date().toISOString(),
  }, null, 2));
  console.log("\nMultisig address saved to scripts/multisig-address.json");
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});