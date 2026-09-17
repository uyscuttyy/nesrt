#!/usr/bin/env node
import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config({ path: "./app/.env.local" });

const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const KLEND_PROGRAM_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

const DEFAULT_PUBKEY = new PublicKey("11111111111111111111111111111111");

// ACTUAL on-chain SOL reserve accounts (from reserve account data)
const SOL_RESERVE = new PublicKey("24EfeXj3XyLLE6GThh8ik4vcxEPMooAU5XXDL5nJHEr8");
const SOL_LIQUIDITY_SUPPLY_VAULT = new PublicKey("11111111111111111111113gsEq31H8iub4Z");
const SOL_COLLATERAL_MINT = new PublicKey("ADJBz6AsFWzVbYa8UoCiP9GC7whpXzbbPcjGUYmy1oKu");
const SOL_COLLATERAL_SUPPLY_VAULT = new PublicKey("1111111111111111111112VJ8HYAjmH1rYm5");
const SOL_LIQUIDITY_TOKEN_PROGRAM = new PublicKey("HTq9uBN3ZTvPPdQp8qVuyEYoNf7Q5RcvheNjwr8Soxbx");
const SOL_COLLATERAL_TOKEN_PROGRAM = new PublicKey("1111111111111EygWh23fp39YUG2auRey2Xvzy5");
const SOL_LENDING_MARKET = new PublicKey("11111112EbQqGXpWEXfSCNtjuDeQuarrtLmx9vPEVN");
const SOL_LENDING_MARKET_AUTHORITY = new PublicKey("6Z8NSJRizZaXsSAWRQna9xuhhwBnsgzTn7in6BugbRCp");

// Farms program ID (from error logs)
const FARMS_PROGRAM_ID = new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");

async function loadAdminKeypair(): Promise<Keypair> {
  const raw = JSON.parse(fs.readFileSync("./keypairs/nesrt-admin.json", "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

async function rpcCall(method: string, params: any[]): Promise<any> {
  const response = await fetch(SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const result = await response.json();
  if (result.error) throw new Error(`RPC error: ${JSON.stringify(result.error)}`);
  return result.result;
}

async function getLatestBlockhash(): Promise<string> {
  const result = await rpcCall("getLatestBlockhash", [{ commitment: "confirmed" }]);
  return result.value.blockhash;
}

async function getAccountInfo(pubkey: PublicKey): Promise<any> {
  return await rpcCall("getAccountInfo", [pubkey.toBase58(), { encoding: "base64", commitment: "confirmed" }]);
}

async function sendRawTransaction(serializedTx: Buffer): Promise<string> {
  const result = await rpcCall("sendTransaction", [
    serializedTx.toString("base64"),
    { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }
  ]);
  return result;
}

async function confirmTransaction(signature: string): Promise<void> {
  let confirmed = false;
  for (let i = 0; i < 30; i++) {
    const result = await rpcCall("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    if (result.value[0] && (result.value[0].confirmationStatus === "confirmed" || result.value[0].confirmationStatus === "finalized")) {
      confirmed = true;
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!confirmed) throw new Error(`Transaction ${signature} not confirmed after 30s`);
}

async function main() {
  console.log("🔧 ==========================================");
  console.log("🔧  NESRT DEVNET SOL RESERVE CRANK - RAW RPC");
  console.log("🔧 ==========================================");
  console.log("RPC:", SOLANA_RPC_URL);
  console.log("Reserve:", SOL_RESERVE.toBase58());
  console.log("");

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const admin = await loadAdminKeypair();
  console.log("Admin wallet:", admin.publicKey.toBase58());
  
  // Check SOL balance
  const solBalance = await connection.getBalance(admin.publicKey);
  console.log("Admin SOL balance:", solBalance / 1e9, "SOL");
  console.log("");

  // Use the obligation PDA that the program derives internally
  const obligationPda = new PublicKey("2nGfw9wVBrBt87UEt4L1nqrNuYiFYozhiD5aJjfsZYGU");
  console.log("Obligation PDA (SDK-derived):", obligationPda.toBase58());

  // Derive user metadata PDA
  const [userMetadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_meta"), admin.publicKey.toBuffer()],
    KLEND_PROGRAM_ID
  );
  console.log("User metadata PDA:", userMetadataPda.toBase58());

  // Check if obligation exists
  const obligationAccount = await getAccountInfo(obligationPda);
  if (!obligationAccount || !obligationAccount.value) {
    // Check if user metadata exists
    const userMetadataAccount = await getAccountInfo(userMetadataPda);
    if (!userMetadataAccount || !userMetadataAccount.value) {
      console.log("📋 STEP 0: Creating user metadata (initUserMetadata)...");
      
      const initUserMetadataDisc = Buffer.from([117, 169, 176, 69, 197, 23, 15, 162]);
      const argsData = Buffer.alloc(1);
      argsData[0] = 0;
      const ixData = Buffer.concat([initUserMetadataDisc, argsData]);
      
      const initUserMetadataIx = new (require("@solana/web3.js").TransactionInstruction)({
        programId: KLEND_PROGRAM_ID,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: true },
          { pubkey: admin.publicKey, isSigner: true, isWritable: true },
          { pubkey: userMetadataPda, isSigner: false, isWritable: true },
          { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: ixData,
      });

      const tx = new Transaction().add(initUserMetadataIx);
      tx.feePayer = admin.publicKey;
      tx.recentBlockhash = await getLatestBlockhash();
      tx.sign(admin);
      const serialized = tx.serialize();
      const sig = await sendRawTransaction(serialized);
      await confirmTransaction(sig);
      console.log("✅ User metadata created:", sig);
    } else {
      console.log("✅ User metadata already exists");
    }
    console.log("");

    console.log("📋 STEP 1: Creating obligation (initObligation)...");
    
    const initObligationDisc = Buffer.from([251, 10, 231, 76, 27, 11, 159, 96]);
    const argsData2 = Buffer.from([0, 0]);
    const ixData2 = Buffer.concat([initObligationDisc, argsData2]);
    
    const initObligationIx = new (require("@solana/web3.js").TransactionInstruction)({
      programId: KLEND_PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: obligationPda, isSigner: false, isWritable: true },
        { pubkey: SOL_LENDING_MARKET, isSigner: false, isWritable: false },
        { pubkey: DEFAULT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: DEFAULT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: userMetadataPda, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: ixData2,
    });

    const tx2 = new Transaction().add(initObligationIx);
    tx2.feePayer = admin.publicKey;
    tx2.recentBlockhash = await getLatestBlockhash();
    tx2.sign(admin);
    const serialized2 = tx2.serialize();
    const sig2 = await sendRawTransaction(serialized2);
    await confirmTransaction(sig2);
    console.log("✅ Obligation created:", sig2);
  } else {
    console.log("✅ Obligation already exists");
  }
  console.log("");

  // Derive obligation's cToken ATA (for obligation collateral)
  const [obligationCollateralAta] = PublicKey.findProgramAddressSync(
    [obligationPda.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), SOL_COLLATERAL_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  console.log("Obligation collateral ATA:", obligationCollateralAta.toBase58());

  // Create obligation collateral ATA if needed
  const collateralAtaInfo = await getAccountInfo(obligationCollateralAta);
  if (!collateralAtaInfo || !collateralAtaInfo.value) {
    console.log("📋 Creating obligation collateral ATA...");
    const createAtaIx = createAssociatedTokenAccountInstruction(
      admin.publicKey,
      obligationCollateralAta,
      obligationPda,
      SOL_COLLATERAL_MINT
    );
    const tx = new Transaction().add(createAtaIx);
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = await getLatestBlockhash();
    tx.sign(admin);
    const serialized = tx.serialize();
    const sig = await sendRawTransaction(serialized);
    await confirmTransaction(sig);
    console.log("✅ Collateral ATA created:", sig);
  } else {
    console.log("✅ Collateral ATA already exists");
  }
  console.log("");

  // For native SOL borrowing, destination is admin's wallet (no ATA needed)
  const borrowDestination = admin.publicKey;
  console.log("Borrow destination (admin wallet):", borrowDestination.toBase58());

  // Discriminators
  const refreshDisc = Buffer.from([33, 132, 147, 228, 151, 192, 72, 89]);
  const depositLiquidityDisc = Buffer.from([169, 201, 30, 126, 6, 205, 102, 68]);
  const borrowDisc = Buffer.from([121, 127, 18, 204, 73, 245, 225, 65]);

  // STEP 2: Refresh + Deposit 2 SOL + Borrow 1 SOL in ONE transaction
  console.log("📋 STEP 2: Refresh + Deposit 2 SOL + Borrow 1 SOL (single tx)...");
  
  // Build refresh instruction
  const refreshIx = new (require("@solana/web3.js").TransactionInstruction)({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: SOL_LENDING_MARKET, isSigner: false, isWritable: false },
      { pubkey: obligationPda, isSigner: false, isWritable: true },
    ],
    data: refreshDisc,
  });

  // Build deposit liquidity instruction (2 SOL = 2_000_000_000 lamports)
  const depositAmt = Buffer.alloc(8);
  depositAmt.writeBigUInt64LE(BigInt("2000000000")); // 2 SOL in lamports
  const depositIxData = Buffer.concat([depositLiquidityDisc, depositAmt]);
  
  const depositIx = new (require("@solana/web3.js").TransactionInstruction)({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },                        // owner
      { pubkey: SOL_RESERVE, isSigner: false, isWritable: true },                          // reserve
      { pubkey: SOL_LENDING_MARKET, isSigner: false, isWritable: false },                  // lendingMarket
      { pubkey: SOL_LENDING_MARKET_AUTHORITY, isSigner: false, isWritable: false },        // lendingMarketAuthority
      { pubkey: DEFAULT_PUBKEY, isSigner: false, isWritable: false },                      // reserveLiquidityMint (native SOL)
      { pubkey: SOL_LIQUIDITY_SUPPLY_VAULT, isSigner: false, isWritable: true },           // reserveLiquiditySupply
      { pubkey: SOL_COLLATERAL_MINT, isSigner: false, isWritable: true },                  // reserveCollateralMint
      { pubkey: admin.publicKey, isSigner: false, isWritable: true },                      // userSourceLiquidity (native SOL from wallet)
      { pubkey: obligationCollateralAta, isSigner: false, isWritable: true },              // userDestinationCollateral
      { pubkey: SOL_COLLATERAL_TOKEN_PROGRAM, isSigner: false, isWritable: false },        // collateralTokenProgram
      { pubkey: SOL_LIQUIDITY_TOKEN_PROGRAM, isSigner: false, isWritable: false },         // liquidityTokenProgram
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false }, // instructionSysvarAccount
    ],
    data: depositIxData,
  });

  const borrowAmt = Buffer.alloc(8);
  borrowAmt.writeBigUInt64LE(BigInt("1000000000")); // 1 SOL in lamports
  const borrowIxData = Buffer.concat([borrowDisc, borrowAmt]);
  
  const borrowIx = new (require("@solana/web3.js").TransactionInstruction)({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },                        // owner
      { pubkey: obligationPda, isSigner: false, isWritable: true },                        // obligation
      { pubkey: SOL_LENDING_MARKET, isSigner: false, isWritable: false },                  // lendingMarket
      { pubkey: SOL_LENDING_MARKET_AUTHORITY, isSigner: false, isWritable: false },        // lendingMarketAuthority
      { pubkey: SOL_RESERVE, isSigner: false, isWritable: true },                          // reserve
      { pubkey: DEFAULT_PUBKEY, isSigner: false, isWritable: false },                      // reserveLiquidityMint
      { pubkey: SOL_LIQUIDITY_SUPPLY_VAULT, isSigner: false, isWritable: true },           // reserveLiquiditySupply
      { pubkey: SOL_LIQUIDITY_SUPPLY_VAULT, isSigner: false, isWritable: true },           // userDestinationLiquidity (native SOL to wallet)
      { pubkey: borrowDestination, isSigner: false, isWritable: true },                    // obligationLiquidity (user's wallet)
      { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },                    // program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },                    // tokenProgram
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false }, // instructionSysvarAccount
    ],
    data: borrowIxData,
  });

  // SINGLE TRANSACTION: refresh -> deposit -> borrow
  const combinedTx = new Transaction()
    .add(refreshIx)
    .add(depositIx)
    .add(borrowIx);
  
  combinedTx.feePayer = admin.publicKey;
  combinedTx.recentBlockhash = await getLatestBlockhash();
  combinedTx.sign(admin);
  
  const combinedSig = await sendRawTransaction(combinedTx.serialize());
  await confirmTransaction(combinedSig);
  console.log("✅ Refresh + Deposit + Borrow (single tx):", combinedSig);
  console.log("");

  // Wait for state to settle
  await new Promise(r => setTimeout(r, 3000));

  // STEP 3: Push utilization higher - deposit 5 more, borrow 3 more
  console.log("📋 STEP 3: Pushing utilization higher - deposit 5 more SOL, borrow 3 more SOL...");
  
  const depositAmt2 = Buffer.alloc(8);
  depositAmt2.writeBigUInt64LE(BigInt("5000000000")); // 5 SOL
  const depositIxData2 = Buffer.concat([depositLiquidityDisc, depositAmt2]);
  
  const deposit2Ix = new (require("@solana/web3.js").TransactionInstruction)({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: SOL_RESERVE, isSigner: false, isWritable: true },
      { pubkey: SOL_LENDING_MARKET, isSigner: false, isWritable: false },
      { pubkey: SOL_LENDING_MARKET_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: DEFAULT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SOL_LIQUIDITY_SUPPLY_VAULT, isSigner: false, isWritable: true },
      { pubkey: SOL_COLLATERAL_MINT, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: false, isWritable: true },
      { pubkey: obligationCollateralAta, isSigner: false, isWritable: true },
      { pubkey: SOL_COLLATERAL_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SOL_LIQUIDITY_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    data: depositIxData2,
  });

  const borrow2Amt = Buffer.alloc(8);
  borrow2Amt.writeBigUInt64LE(BigInt("3000000000")); // 3 SOL
  const borrow2IxData = Buffer.concat([borrowDisc, borrow2Amt]);
  
  const borrow2Ix = new (require("@solana/web3.js").TransactionInstruction)({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: obligationPda, isSigner: false, isWritable: true },
      { pubkey: SOL_LENDING_MARKET, isSigner: false, isWritable: false },
      { pubkey: SOL_LENDING_MARKET_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: SOL_RESERVE, isSigner: false, isWritable: true },
      { pubkey: DEFAULT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SOL_LIQUIDITY_SUPPLY_VAULT, isSigner: false, isWritable: true },
      { pubkey: SOL_LIQUIDITY_SUPPLY_VAULT, isSigner: false, isWritable: true },
      { pubkey: borrowDestination, isSigner: false, isWritable: true },
      { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    data: borrow2IxData,
  });

  const combinedTx2 = new Transaction()
    .add(deposit2Ix)
    .add(borrow2Ix);
  
  combinedTx2.feePayer = admin.publicKey;
  combinedTx2.recentBlockhash = await getLatestBlockhash();
  combinedTx2.sign(admin);
  
  const combinedSig2 = await sendRawTransaction(combinedTx2.serialize());
  await confirmTransaction(combinedSig2);
  console.log("✅ Additional deposit + borrow:", combinedSig2);
  console.log("");

  // STEP 4: One more push - deposit 10, borrow 6
  console.log("📋 STEP 4: Final push - deposit 10 SOL, borrow 6 SOL...");
  
  const depositAmt3 = Buffer.alloc(8);
  depositAmt3.writeBigUInt64LE(BigInt("10000000000")); // 10 SOL
  const depositIxData3 = Buffer.concat([depositLiquidityDisc, depositAmt3]);
  
  const deposit3Ix = new (require("@solana/web3.js").TransactionInstruction)({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: SOL_RESERVE, isSigner: false, isWritable: true },
      { pubkey: SOL_LENDING_MARKET, isSigner: false, isWritable: false },
      { pubkey: SOL_LENDING_MARKET_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: DEFAULT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SOL_LIQUIDITY_SUPPLY_VAULT, isSigner: false, isWritable: true },
      { pubkey: SOL_COLLATERAL_MINT, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: false, isWritable: true },
      { pubkey: obligationCollateralAta, isSigner: false, isWritable: true },
      { pubkey: SOL_COLLATERAL_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SOL_LIQUIDITY_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    data: depositIxData3,
  });

  const borrow3Amt = Buffer.alloc(8);
  borrow3Amt.writeBigUInt64LE(BigInt("6000000000")); // 6 SOL
  const borrow3IxData = Buffer.concat([borrowDisc, borrow3Amt]);
  
  const borrow3Ix = new (require("@solana/web3.js").TransactionInstruction)({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: obligationPda, isSigner: false, isWritable: true },
      { pubkey: SOL_LENDING_MARKET, isSigner: false, isWritable: false },
      { pubkey: SOL_LENDING_MARKET_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: SOL_RESERVE, isSigner: false, isWritable: true },
      { pubkey: DEFAULT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SOL_LIQUIDITY_SUPPLY_VAULT, isSigner: false, isWritable: true },
      { pubkey: SOL_LIQUIDITY_SUPPLY_VAULT, isSigner: false, isWritable: true },
      { pubkey: borrowDestination, isSigner: false, isWritable: true },
      { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    data: borrow3IxData,
  });

  const combinedTx3 = new Transaction()
    .add(deposit3Ix)
    .add(borrow3Ix);
  
  combinedTx3.feePayer = admin.publicKey;
  combinedTx3.recentBlockhash = await getLatestBlockhash();
  combinedTx3.sign(admin);
  
  const combinedSig3 = await sendRawTransaction(combinedTx3.serialize());
  await confirmTransaction(combinedSig3);
  console.log("✅ Final deposit + borrow:", combinedSig3);
  console.log("");

  // Verify final state
  console.log("🔍 Verifying final reserve state...");
  const reserveAccount = await getAccountInfo(SOL_RESERVE);
  if (reserveAccount?.value) {
    console.log("Reserve account found, data length:", reserveAccount.value.data[0].length);
  }

  console.log("");
  console.log("🔧 ==========================================");
  console.log("🔧  SOL CRANK EXECUTION COMPLETE");
  console.log("🔧 ==========================================");
  console.log("");
  console.log("Run the analysis script to verify utilization > 0%:");
  console.log("  npx tsx scripts/devnet-crank.ts");
  console.log("");
  console.log("Check Kamino reserve on explorer:");
  console.log("  https://explorer.solana.com/address/" + SOL_RESERVE.toBase58() + "?cluster=devnet");
}

main().catch((e) => {
  console.error("❌ Crank failed:", e);
  process.exit(1);
});