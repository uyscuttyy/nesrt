import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { BN } from "bn.js";
import * as fs from "fs";

const DLMM = require("@meteora-ag/dlmm");

async function main() {
  console.log("🔧 Creating nTSLA/USDC Meteora DLMM pool on Devnet...\n");

  // Configuration
  const RPC_URL = "https://api.devnet.solana.com";
  const connection = new Connection(RPC_URL, "confirmed");
  
  // Load admin keypair (has 880K TSLAx and is mint authority)
  const raw = JSON.parse(fs.readFileSync("./keypairs/nesrt-admin.json", "utf-8"));
  const admin = Keypair.fromSecretKey(new Uint8Array(raw));
  
  const ntslaMint = new PublicKey("GYoTAg6bicNQcUk2R31JUFxZieSNbm93yGHgcCTw4rjS");
  const usdcMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // Devnet USDC
  
  console.log("Admin:", admin.publicKey.toBase58());
  console.log("nTSLA mint:", ntslaMint.toBase58());
  console.log("USDC mint:", usdcMint.toBase58());
  console.log("");

  // Step 1: Check if pool already exists
  console.log("📋 Step 1: Checking if nTSLA/USDC pool already exists...");
  const existingPair = await findExistingPool(connection, ntslaMint, usdcMint);
  
  if (existingPair) {
    console.log("✅ Pool already exists!");
    console.log("Pool address:", existingPair.toBase58());
    console.log("View on Meteora: https://app.meteora.ag/dlmm/" + existingPair.toBase58() + "?cluster=devnet");
    return;
  }

  console.log("Pool does not exist. Creating new pool...\n");

  // Step 2: Check if we have the preset parameter for binStep=10
  console.log("📋 Step 2: Checking preset parameter for binStep=10...");
  const program = DLMM.createProgram(connection, "devnet");
  
  const { derivePresetParameter } = require("@meteora-ag/dlmm");
  const presetParam = DLMM.derivePresetParameter(new BN(10), new BN(10000), program.programId);
  console.log("Preset parameter:", presetParam[0].toBase58());
  
  const presetAccount = await program.account.presetParameter.fetchNullable(presetParam[0]);
  if (!presetAccount) {
    console.log("⚠️ Preset parameter doesn't exist. Need to create it first.");
    console.log("This requires calling initializePresetParameter instruction.");
    console.log("This typically needs to be done by Meteora team or via their UI.\n");
  } else {
    console.log("✅ Preset parameter exists!\n");
  }

  // Step 3: Check token badges
  console.log("📋 Step 3: Checking token badges...");
  const { deriveTokenBadge } = require("@meteora-ag/dlmm");
  const [badgeX] = DLMM.deriveTokenBadge(ntslaMint, program.programId);
  const [badgeY] = DLMM.deriveTokenBadge(usdcMint, program.programId);
  console.log("nTSLA badge:", badgeX.toBase58());
  console.log("USDC badge:", badgeY.toBase58());

  // Step 4: Try to create the pool using createCustomizablePermissionlessLbPair
  // This is the simplest method that doesn't require preset parameters
  console.log("\n📋 Step 4: Creating pool via createCustomizablePermissionlessLbPair...");
  
  try {
    const tx = await DLMM.createCustomizablePermissionlessLbPair(
      connection,
      admin.publicKey,  // funder
      ntslaMint,        // tokenX
      usdcMint,         // tokenY
      10,               // binStep (plain number)
      10,               // activeId (plain number, 10 = 1:1 for binStep 10)
      { cluster: "devnet" }
    );

    console.log("Transaction created!");
    console.log("Transaction length:", tx.length);
    
    // Sign and send
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(admin);
    
    const sig = await connection.sendRawTransaction(tx.serialize());
    console.log("Transaction sent:", sig);
    console.log("View on explorer: https://explorer.solana.com/tx/" + sig + "?cluster=devnet");
    
    // Wait for confirmation
    await connection.confirmTransaction(sig, "confirmed");
    console.log("✅ Pool created successfully!");
    
    // Find the new pool
    const pairs = await DLMM.getLbPairs(connection, "devnet");
    for (const pair of pairs) {
      const account = pair.account;
      if ((account.tokenXMint.equals(ntslaMint) && account.tokenYMint.equals(usdcMint)) ||
          (account.tokenXMint.equals(usdcMint) && account.tokenYMint.equals(ntslaMint))) {
        console.log("\n✅ Pool created successfully!");
        console.log("Pool address:", pair.publicKey.toBase58());
        console.log("Meteora URL: https://app.meteora.ag/dlmm/" + pair.publicKey.toBase58() + "?cluster=devnet");
        break;
      }
    }
  } catch (e) {
    console.error("Error creating pool:", e.message);
    
    // Fallback: provide manual creation link
    console.log("\n📋 Fallback: Manual pool creation via Meteora UI");
    console.log("Visit: https://app.meteora.ag/dlmm/create?cluster=devnet");
    console.log("Token X: " + ntslaMint.toBase58() + " (nTSLA)");
    console.log("Token Y: " + usdcMint.toBase58() + " (USDC)");
    console.log("Bin step: 10");
    console.log("Active ID: 10 (1:1 price)");
    console.log("Base factor: 10000");
  }
}

async function findExistingPool(connection, tokenX, tokenY) {
  try {
    const pairs = await DLMM.getLbPairs(connection, "devnet");
    for (const pair of pairs) {
      const account = pair.account;
      if (account.tokenXMint && account.tokenYMint) {
        if ((account.tokenXMint.equals(tokenX) && account.tokenYMint.equals(tokenY)) ||
            (account.tokenXMint.equals(tokenY) && account.tokenYMint.equals(tokenX))) {
          return pair.publicKey;
        }
      }
    }
  } catch (e) {
    // Ignore
  }
  return null;
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});