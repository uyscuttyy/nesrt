import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config({ path: "../app/.env.local" });

const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const VAULT_PROGRAM_ID = new PublicKey("DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB");
const TSLAX_MINT = new PublicKey("4Dimn4s78herJKGhD3oxMMGbZcjirgwt376tdjq4HevA");

async function loadAdminKeypair(): Promise<Keypair> {
  const raw = JSON.parse(fs.readFileSync("./keypairs/nesrt-admin.json", "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

async function loadMultisigAddress(): Promise<string> {
  const raw = JSON.parse(fs.readFileSync("./scripts/multisig-address.json", "utf-8"));
  return raw.multisig;
}

async function main() {
  console.log("🔧 Transferring Vault Admin to Squads Multisig...\n");

  if (!process.env.NEXT_PUBLIC_SOLANA_RPC_URL) {
    console.error("❌ Missing RPC URL");
    process.exit(1);
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const admin = await loadAdminKeypair();
  const multisigAddress = await loadMultisigAddress();
  const multisigPda = new PublicKey(multisigAddress);

  console.log("Current admin:", admin.publicKey.toBase58());
  console.log("New admin (multisig):", multisigPda.toBase58());
  console.log("");

  // Find the VaultState PDA (seed: "vault-v2" + tslax_mint)
  const [vaultStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-v2"), TSLAX_MINT.toBuffer()],
    VAULT_PROGRAM_ID
  );

  console.log("VaultState PDA:", vaultStatePda.toBase58());

  // Check current admin by fetching the account
  const vaultStateAccount = await connection.getAccountInfo(vaultStatePda);
  if (!vaultStateAccount) {
    console.error("❌ VaultState account not found at:", vaultStatePda.toBase58());
    process.exit(1);
  }
  console.log("VaultState account found, data length:", vaultStateAccount.data.length);

  // Parse current admin from account data
  // VaultState layout: discriminator(8) + admin(32) + ...
  const currentAdminBytes = vaultStateAccount.data.slice(8, 40);
  const currentAdmin = new PublicKey(currentAdminBytes);
  console.log("Current VaultState.admin:", currentAdmin.toBase58());
  console.log("Expected admin (deployer):", admin.publicKey.toBase58());
  console.log("Match:", currentAdmin.equals(admin.publicKey));

  // Execute setAdmin instruction using raw instruction
  const setAdminDiscriminator = Buffer.from([251, 163, 0, 52, 91, 194, 187, 92]);
  
  // Build instruction manually
  const ix = new (require("@solana/web3.js").TransactionInstruction)({
    programId: VAULT_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },      // admin
      { pubkey: multisigPda, isSigner: false, isWritable: false },        // newAdmin
      { pubkey: vaultStatePda, isSigner: false, isWritable: true },       // vaultState
    ],
    data: setAdminDiscriminator,
  });

  console.log("\n📋 Executing setAdmin to transfer authority to multisig...");
  const tx = new Transaction().add(ix);
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(admin);

  const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });

  console.log("\n✅ Admin transferred successfully!");
  console.log("Transaction:", sig);
  console.log("View on explorer: https://explorer.solana.com/tx/" + sig + "?cluster=devnet");

  // Verify the transfer by re-fetching the account
  console.log("\n🔍 Verifying admin transfer...");
  const updatedAccount = await connection.getAccountInfo(vaultStatePda);
  if (!updatedAccount) {
    console.error("❌ VaultState account not found after transfer");
    process.exit(1);
  }
  
  // Parse the admin from the account data
  const newAdminBytes = updatedAccount.data.slice(8, 40);
  const newAdmin = new PublicKey(newAdminBytes);
  console.log("New VaultState.admin:", newAdmin.toBase58());
  console.log("Expected (multisig):", multisigPda.toBase58());
  console.log("Match:", newAdmin.equals(multisigPda));

  if (newAdmin.equals(multisigPda)) {
    console.log("\n✅ VERIFICATION PASSED: Vault admin is now the Squads multisig!");
  } else {
    console.log("\n❌ VERIFICATION FAILED: Admin not transferred correctly");
    process.exit(1);
  }
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});