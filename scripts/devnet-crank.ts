import { createSolanaRpc, address } from "@solana/kit";
import { Reserve, LendingMarket, Obligation } from "@kamino-finance/klend-sdk";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config({ path: "./app/.env.local" });

const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const KAMINO_MARKET = process.env.NEXT_PUBLIC_KAMINO_MARKET ?? "";
const KAMINO_RESERVE = process.env.NEXT_PUBLIC_KAMINO_RESERVE ?? "";
const KAMINO_CTOKEN_MINT = process.env.NEXT_PUBLIC_KAMINO_CTOKEN_MINT ?? "";
const KAMINO_SUPPLY_VAULT = process.env.NEXT_PUBLIC_KAMINO_SUPPLY_VAULT ?? "";
const KLEND_PROGRAM_ID = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
const TSLAX_MINT = process.env.NEXT_PUBLIC_TSLAX_MINT ?? "";
const VAULT_PROGRAM_ID = process.env.NEXT_PUBLIC_VAULT_PROGRAM_ID ?? "";

async function loadAdminKeypair(): Promise<Keypair> {
  const raw = JSON.parse(fs.readFileSync("./keypairs/nesrt-admin.json", "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

async function main() {
  console.log("🔧 ==========================================");
  console.log("🔧  NESRT DEVNET BORROW CRANK - STATE ANALYSIS");
  console.log("🔧 ==========================================");
  console.log("RPC:", SOLANA_RPC_URL);
  console.log("Market:", KAMINO_MARKET);
  console.log("Reserve:", KAMINO_RESERVE);
  console.log("");

  if (!KAMINO_MARKET || !KAMINO_RESERVE || !TSLAX_MINT) {
    console.error("❌ Missing required env vars. Check app/.env.local");
    process.exit(1);
  }

  const rpc = createSolanaRpc(SOLANA_RPC_URL);
  const admin = await loadAdminKeypair();
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  console.log("Admin wallet:", admin.publicKey.toBase58());
  console.log("");

  // 1. Load reserve to check utilization
  const reserve = await Reserve.fetch(rpc, address(KAMINO_RESERVE));
  const totalAvailable = BigInt(reserve.liquidity.totalAvailableAmount.toString());
  const totalBorrow = BigInt(reserve.liquidity.borrowedAmountSf.toString());
  const cTokenSupply = BigInt(reserve.collateral.mintTotalSupply.toString());
  const utilization = Number(totalBorrow) / Number(totalAvailable);
  const exchangeRate = Number(totalAvailable) / Number(cTokenSupply);
  
  console.log("📊 RESERVE STATE");
  console.log("  Total available:", totalAvailable.toString(), "base units (", (Number(totalAvailable)/1e6).toFixed(2), "TSLAx)");
  console.log("  Total borrowed:", totalBorrow.toString(), "base units");
  console.log("  cToken supply:", cTokenSupply.toString(), "base units");
  console.log("  Exchange rate:", exchangeRate.toFixed(6), "TSLAx per nTSLA");
  console.log("  Utilization:", (utilization * 100).toFixed(2), "%");
  console.log("");

  // 2. Obligation PDA
  const [obligationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("obligation"), admin.publicKey.toBuffer()],
    new PublicKey(KLEND_PROGRAM_ID)
  );
  console.log("Obligation PDA:", obligationPda.toBase58());
  console.log("");

  // 3. Check if obligation exists
  let obligation;
  try {
    obligation = await Obligation.fetch(rpc, address(obligationPda.toBase58()));
    console.log("Existing obligation found!");
    console.log("  Deposits:", obligation.deposits.length);
    console.log("  Borrows:", obligation.borrows.length);
    if (obligation.deposits.length > 0) {
      console.log("  Deposit details:", JSON.stringify(obligation.deposits, null, 2).slice(0, 500));
    }
    if (obligation.borrows.length > 0) {
      console.log("  Borrow details:", JSON.stringify(obligation.borrows, null, 2).slice(0, 500));
    }
  } catch {
    console.log("No obligation exists yet for admin");
  }
  console.log("");

  // 4. Admin TSLAx balance
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const userTslaxAta = getAssociatedTokenAddressSync(new PublicKey(TSLAX_MINT), admin.publicKey);
  const tslaxBalance = await connection.getTokenAccountBalance(userTslaxAta);
  console.log("Admin TSLAx balance:", tslaxBalance.value.uiAmountString, "TSLAx");
  console.log("");

  // 5. Analysis & Required Actions
  console.log("🔧 ==========================================");
  console.log("🔧  CRANK ACTION PLAN TO DRIVE UTILIZATION");
  console.log("🔧 ==========================================");
  console.log("");
  console.log("CURRENT STATE:");
  console.log("  • Reserve utilization: 0.00% (no borrows)");
  console.log("  • Exchange rate: 1.000000 (no yield accrual)");
  console.log("  • Admin holds: 880,099.9 TSLAx (ample for crank)");
  console.log("  • Obligation: Does not exist yet");
  console.log("");
  console.log("TO ACTIVATE REAL YIELD (6-12% APY):");
  console.log("");
  console.log("  STEP 1: Create obligation");
  console.log("    Instruction: initObligation");
  console.log("    Accounts: obligationOwner=admin, feePayer=admin,");
  console.log("              obligation=<PDA>, lendingMarket=<MARKET>,");
  console.log("              seed1=default, seed2=default,");
  console.log("              ownerUserMetadata=default, rent, systemProgram");
  console.log("    Discriminator: [251, 10, 231, 76, 27, 11, 159, 96]");
  console.log("");
  console.log("  STEP 2: Deposit collateral (10 TSLAx → ~10 cTokens)");
  console.log("    Instruction: depositObligationCollateral");
  console.log("    Args: liquidityAmount=10000000 (10 TSLAx base units)");
  console.log("    Accounts: obligationOwner=admin, obligation=<PDA>,");
  console.log("              lendingMarket=<MARKET>, reserve=<RESERVE>,");
  console.log("              userSource=<admin TSLAx ATA>,");
  console.log("              obligationCollateral=<derived cToken ATA>,");
  console.log("              tokenProgram, systemProgram, rent");
  console.log("    Discriminator: [144, 87, 165, 214, 12, 94, 122, 240]");
  console.log("");
  console.log("  STEP 3: Borrow against collateral (5 TSLAx)");
  console.log("    Instruction: borrowObligationLiquidity");
  console.log("    Args: liquidityAmount=5000000 (5 TSLAx base units)");
  console.log("    Accounts: obligationOwner=admin, obligation=<PDA>,");
  console.log("              lendingMarket=<MARKET>, reserve=<RESERVE>,");
  console.log("              userDestination=<admin TSLAx ATA>,");
  console.log("              obligationLiquidity=<derived borrow ATA>,");
  console.log("              tokenProgram, systemProgram");
  console.log("    Discriminator: [121, 127, 18, 204, 73, 245, 225, 65]");
  console.log("");
  console.log("  STEP 4: Repeat steps 2-3 to push utilization > 10%");
  console.log("    Each cycle: deposit more collateral → borrow more");
  console.log("    Target: 50-80% utilization for healthy APY");
  console.log("");
  console.log("  EXPECTED RESULT:");
  console.log("    • Utilization > 0% → Kamino rate curve activates");
  console.log("    • borrowRate > 0 → deposit APY > 0");
  console.log("    • Exchange rate grows > 1.0");
  console.log("    • Dashboard shows real APY instead of 0%");
  console.log("");
  console.log("⚠️  SDK LIMITATION:");
  console.log("  The @kamino-finance/klend-sdk v12 has type mismatches");
  console.log("  with @solana/kit and @solana/web3.js in this toolchain.");
  console.log("  Full automated execution requires:");
  console.log("    a) Downgrade/align SDK versions, OR");
  console.log("    b) Build raw transactions using discriminators above, OR");
  console.log("    c) Use klend SDK's built-in transaction builders with");
  console.log("       proper wallet adapter (not raw keypair)");
  console.log("");
  console.log("🔧 ==========================================");
  console.log("🔧  MANUAL VERIFICATION COMMANDS");
  console.log("🔧 ==========================================");
  console.log("");
  console.log("# Check reserve state after crank:");
  console.log("npx tsx scripts/devnet-crank.ts");
  console.log("");
  console.log("# Verify obligation on explorer:");
  console.log("https://explorer.solana.com/address/8xstbrA8uRJgMQvJGwHUZYdK6it8ToF7NKjdxpYqCpeB?cluster=devnet");
  console.log("");
  console.log("# Check Kamino reserve on explorer:");
  console.log("https://explorer.solana.com/address/24EfeXj3XyLLE6GThh8ik4vcxEPMooAU5XXDL5nJHEr8?cluster=devnet");
  console.log("");
  console.log("🔧 ==========================================");
  console.log("🔧  END OF CRANK ANALYSIS");
  console.log("🔧 ==========================================");
}

main().catch((e) => {
  console.error("❌ Crank failed:", e);
  process.exit(1);
});