import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config({ path: "./app/.env.local" });

const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const KAMINO_MARKET = process.env.NEXT_PUBLIC_KAMINO_MARKET ?? "";
const KAMINO_RESERVE = process.env.NEXT_PUBLIC_KAMINO_RESERVE ?? "";
const KAMINO_CTOKEN_MINT = process.env.NEXT_PUBLIC_KAMINO_CTOKEN_MINT ?? "";
const KAMINO_SUPPLY_VAULT = process.env.NEXT_PUBLIC_KAMINO_SUPPLY_VAULT ?? "";
const TSLAX_MINT = process.env.NEXT_PUBLIC_TSLAX_MINT ?? "";
const KLEND_PROGRAM_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

const DEFAULT_PUBKEY = new PublicKey("11111111111111111111111111111111");

// Reserve's collateral supply vault (from error logs and reserve data)
const RESERVE_COLLATERAL_SUPPLY_VAULT = new PublicKey("BVHqS7L5f1rAxfiS3ugq6JFS2p36HNLsDkXJGAptRSQL");

// Lending market authority (derived from "lma" seed + market)
const LENDING_MARKET_AUTHORITY = new PublicKey("3EQrDBAL8bz4nm4EzEPJhE17qXRXkMAH1jjTyuRCoUJV");

// Farms program ID (from error log)
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
  // Poll for confirmation
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
  console.log("🔧  NESRT DEVNET BORROW CRANK - RAW RPC");
  console.log("🔧 ==========================================");
  console.log("RPC:", SOLANA_RPC_URL);
  console.log("Market:", KAMINO_MARKET);
  console.log("Reserve:", KAMINO_RESERVE);
  console.log("");

  if (!KAMINO_MARKET || !KAMINO_RESERVE || !TSLAX_MINT) {
    console.error("❌ Missing required env vars. Check app/.env.local");
    process.exit(1);
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const admin = await loadAdminKeypair();
  console.log("Admin wallet:", admin.publicKey.toBase58());
  console.log("");

  // Use the PDA that the program derives internally (from SDK's VanillaObligation.toPda)
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
        { pubkey: new PublicKey(KAMINO_MARKET), isSigner: false, isWritable: false },
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

  // Derive admin's TSLAx ATA
  const adminTslaxAta = getAssociatedTokenAddressSync(new PublicKey(TSLAX_MINT), admin.publicKey);
  console.log("Admin TSLAx ATA:", adminTslaxAta.toBase58());

  // Check TSLAx balance
  const tslaxBalance = await connection.getTokenAccountBalance(adminTslaxAta);
  console.log("Admin TSLAx balance:", tslaxBalance.value.uiAmountString, "TSLAx");
  console.log("");

  // Derive admin's cToken ATA (for receiving cTokens from liquidity deposit)
  const cTokenMint = new PublicKey(KAMINO_CTOKEN_MINT);
  const adminCTokenAta = getAssociatedTokenAddressSync(cTokenMint, admin.publicKey);
  console.log("Admin cToken ATA:", adminCTokenAta.toBase58());

  // Create admin's cToken ATA if needed
  const adminCTokenAtaInfo = await getAccountInfo(adminCTokenAta);
  if (!adminCTokenAtaInfo || !adminCTokenAtaInfo.value) {
    console.log("📋 Creating admin cToken ATA...");
    const createAtaIx = createAssociatedTokenAccountInstruction(
      admin.publicKey,
      adminCTokenAta,
      admin.publicKey,
      cTokenMint
    );
    const tx = new Transaction().add(createAtaIx);
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = await getLatestBlockhash();
    tx.sign(admin);
    const serialized = tx.serialize();
    const sig = await sendRawTransaction(serialized);
    await confirmTransaction(sig);
    console.log("✅ Admin cToken ATA created:", sig);
  } else {
    console.log("✅ Admin cToken ATA already exists");
  }
  console.log("");

  // Derive obligation's cToken ATA (for obligation collateral)
  const [obligationCollateralAta] = PublicKey.findProgramAddressSync(
    [obligationPda.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), cTokenMint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  console.log("Obligation collateral ATA (user's cToken):", obligationCollateralAta.toBase58());

  // Reserve's collateral supply vault - THIS is what the combined deposit uses for exchange rate
  const reserveCollateralSupplyVault = RESERVE_COLLATERAL_SUPPLY_VAULT;
  console.log("Reserve collateral supply vault:", reserveCollateralSupplyVault.toBase58());

  // Create obligation's cToken ATA if needed
  const collateralAtaInfo = await getAccountInfo(obligationCollateralAta);
  if (!collateralAtaInfo || !collateralAtaInfo.value) {
    console.log("📋 Creating obligation collateral ATA...");
    const createAtaIx = createAssociatedTokenAccountInstruction(
      admin.publicKey,
      obligationCollateralAta,
      obligationPda,
      cTokenMint
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

  // Derive borrow destination ATA
  const [borrowDestinationAta] = PublicKey.findProgramAddressSync(
    [obligationPda.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), new PublicKey(TSLAX_MINT).toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  console.log("Borrow destination ATA:", borrowDestinationAta.toBase58());

  // Create borrow destination ATA if needed
  const borrowAtaInfo = await getAccountInfo(borrowDestinationAta);
  if (!borrowAtaInfo || !borrowAtaInfo.value) {
    console.log("Creating borrow destination ATA...");
    const createBorrowAtaIx = createAssociatedTokenAccountInstruction(
      admin.publicKey,
      borrowDestinationAta,
      obligationPda,
      new PublicKey(TSLAX_MINT)
    );
    const tx = new Transaction().add(createBorrowAtaIx);
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = await getLatestBlockhash();
    tx.sign(admin);
    const sig = await sendRawTransaction(tx.serialize());
    await confirmTransaction(sig);
    console.log("✅ Borrow destination ATA created:", sig);
  }

  // Discriminators
  const refreshDisc = Buffer.from([33, 132, 147, 228, 151, 192, 72, 89]);
  const depositLiquidityDisc = Buffer.from([169, 201, 30, 126, 6, 205, 102, 68]);
  const combinedDepositDisc = Buffer.from([216, 224, 191, 27, 204, 151, 102, 175]);
  const borrowDisc = Buffer.from([121, 127, 18, 204, 73, 245, 225, 65]);

  // STEP 2: Bootstrap reserve with liquidity (depositReserveLiquidity) 
  // KEY FIX: Use RESERVE_COLLATERAL_SUPPLY_VAULT as userDestinationCollateral so vault gets cToken supply
  console.log("📋 STEP 2: Bootstrapping reserve with 50 TSLAx liquidity (depositReserveLiquidity)...");
  console.log("   Using reserve's collateral supply vault as cToken destination for exchange rate bootstrap");
  
  const depositLiquidityAmt = Buffer.alloc(8);
  depositLiquidityAmt.writeBigUInt64LE(BigInt("50000000"));
  const depositLiquidityData = Buffer.concat([depositLiquidityDisc, depositLiquidityAmt]);
  
  const depositLiquidityIx = new (require("@solana/web3.js").TransactionInstruction)({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },                        // owner
      { pubkey: new PublicKey(KAMINO_RESERVE), isSigner: false, isWritable: true },        // reserve
      { pubkey: new PublicKey(KAMINO_MARKET), isSigner: false, isWritable: false },        // lendingMarket
      { pubkey: LENDING_MARKET_AUTHORITY, isSigner: false, isWritable: false },            // lendingMarketAuthority
      { pubkey: new PublicKey(TSLAX_MINT), isSigner: false, isWritable: false },           // reserveLiquidityMint
      { pubkey: new PublicKey(KAMINO_SUPPLY_VAULT), isSigner: false, isWritable: true },   // reserveLiquiditySupply
      { pubkey: new PublicKey(KAMINO_CTOKEN_MINT), isSigner: false, isWritable: true },    // reserveCollateralMint
      { pubkey: adminTslaxAta, isSigner: false, isWritable: true },                        // userSourceLiquidity
      { pubkey: RESERVE_COLLATERAL_SUPPLY_VAULT, isSigner: false, isWritable: true },      // userDestinationCollateral = RESERVE VAULT (critical!)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },                    // collateralTokenProgram
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },                    // liquidityTokenProgram
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false }, // instructionSysvarAccount
    ],
    data: depositLiquidityData,
  });

  const liquidityTx = new Transaction().add(depositLiquidityIx);
  liquidityTx.feePayer = admin.publicKey;
  liquidityTx.recentBlockhash = await getLatestBlockhash();
  liquidityTx.sign(admin);
  
  const liquiditySig = await sendRawTransaction(liquidityTx.serialize());
  await confirmTransaction(liquiditySig);
  console.log("✅ Reserve liquidity bootstrap:", liquiditySig);
  console.log("");

  // Wait for state to settle
  await new Promise(r => setTimeout(r, 3000));

  // STEP 3: Refresh + Combined deposit + borrow in ONE transaction
  console.log("📋 STEP 3: Refresh + Combined deposit 10 TSLAx + borrow 5 TSLAx (single tx)...");
  
  // Build refresh instruction
  const refreshIx = new (require("@solana/web3.js").TransactionInstruction)({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(KAMINO_MARKET), isSigner: false, isWritable: false },
      { pubkey: obligationPda, isSigner: false, isWritable: true },
    ],
    data: refreshDisc,
  });

  // Build combined deposit data for first tx (10 TSLAx)
  const depositAmt1 = Buffer.alloc(8);
  depositAmt1.writeBigUInt64LE(BigInt("10000000"));
  const depositIxData1 = Buffer.concat([combinedDepositDisc, depositAmt1]);
  
  // Build combined deposit instruction - userDestinationCollateral = obligationCollateralAta
  const combinedDepositIx = new (require("@solana/web3.js").TransactionInstruction)({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: obligationPda, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(KAMINO_MARKET), isSigner: false, isWritable: false },
      { pubkey: LENDING_MARKET_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(KAMINO_RESERVE), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(TSLAX_MINT), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(KAMINO_SUPPLY_VAULT), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(KAMINO_CTOKEN_MINT), isSigner: false, isWritable: true },
      { pubkey: RESERVE_COLLATERAL_SUPPLY_VAULT, isSigner: false, isWritable: true },
      { pubkey: adminTslaxAta, isSigner: false, isWritable: true },
      { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: FARMS_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: depositIxData1,
  });

  const borrowAmt1 = Buffer.alloc(8);
  borrowAmt1.writeBigUInt64LE(BigInt("5000000"));
  const borrowIxData1 = Buffer.concat([borrowDisc, borrowAmt1]);
  
  const borrowIx = new (require("@solana/web3.js").TransactionInstruction)({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: obligationPda, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(KAMINO_MARKET), isSigner: false, isWritable: false },
      { pubkey: LENDING_MARKET_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(KAMINO_RESERVE), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(TSLAX_MINT), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(KAMINO_SUPPLY_VAULT), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(KAMINO_SUPPLY_VAULT), isSigner: false, isWritable: true },
      { pubkey: borrowDestinationAta, isSigner: false, isWritable: true },
      { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    data: borrowIxData1,
  });

  // SINGLE TRANSACTION: refresh -> deposit -> borrow
  const combinedTx = new Transaction()
    .add(refreshIx)
    .add(combinedDepositIx)
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

  // STEP 4: Push utilization higher
  console.log("📋 STEP 4: Pushing utilization higher - deposit 20 more, borrow 15 more...");
  
  const depositAmt2 = Buffer.alloc(8);
  depositAmt2.writeBigUInt64LE(BigInt("20000000"));
  const depositIxData2 = Buffer.concat([combinedDepositDisc, depositAmt2]);
  
  const combinedDeposit2Ix = new (require("@solana/web3.js").TransactionInstruction)({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: obligationPda, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(KAMINO_MARKET), isSigner: false, isWritable: false },
      { pubkey: LENDING_MARKET_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(KAMINO_RESERVE), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(TSLAX_MINT), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(KAMINO_SUPPLY_VAULT), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(KAMINO_CTOKEN_MINT), isSigner: false, isWritable: true },
      { pubkey: RESERVE_COLLATERAL_SUPPLY_VAULT, isSigner: false, isWritable: true },
      { pubkey: adminTslaxAta, isSigner: false, isWritable: true },
      { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: FARMS_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: depositIxData2,
  });

  const borrow2Amt = Buffer.alloc(8);
  borrow2Amt.writeBigUInt64LE(BigInt("15000000"));
  const borrow2IxData = Buffer.concat([borrowDisc, borrow2Amt]);
  
  const borrow2Ix = new (require("@solana/web3.js").TransactionInstruction)({
    programId: KLEND_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: obligationPda, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(KAMINO_MARKET), isSigner: false, isWritable: false },
      { pubkey: LENDING_MARKET_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(KAMINO_RESERVE), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(TSLAX_MINT), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(KAMINO_SUPPLY_VAULT), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(KAMINO_SUPPLY_VAULT), isSigner: false, isWritable: true },
      { pubkey: borrowDestinationAta, isSigner: false, isWritable: true },
      { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    data: borrow2IxData,
  });

  // Second combined transaction
  const combinedTx2 = new Transaction()
    .add(combinedDeposit2Ix)
    .add(borrow2Ix);
  
  combinedTx2.feePayer = admin.publicKey;
  combinedTx2.recentBlockhash = await getLatestBlockhash();
  combinedTx2.sign(admin);
  
  const combinedSig2 = await sendRawTransaction(combinedTx2.serialize());
  await confirmTransaction(combinedSig2);
  console.log("✅ Additional combined deposit + borrow:", combinedSig2);
  console.log("");

  // Verify final state
  console.log("🔍 Verifying final reserve state...");
  const reserveAccount = await getAccountInfo(new PublicKey(KAMINO_RESERVE));
  if (reserveAccount?.value) {
    console.log("Reserve account found, data length:", reserveAccount.value.data[0].length);
  }

  console.log("");
  console.log("🔧 ==========================================");
  console.log("🔧  CRANK EXECUTION COMPLETE");
  console.log("🔧 ==========================================");
  console.log("");
  console.log("Run the analysis script to verify utilization > 0%:");
  console.log("  npx tsx scripts/devnet-crank.ts");
  console.log("");
  console.log("Check Kamino reserve on explorer:");
  console.log("  https://explorer.solana.com/address/" + KAMINO_RESERVE + "?cluster=devnet");
}

main().catch((e) => {
  console.error("❌ Crank failed:", e);
  process.exit(1);
});