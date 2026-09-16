const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram, Transaction, TransactionInstruction } = require("@solana/web3.js");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault;
  const admin = provider.wallet;
  const conn = program.provider.connection;
  const TSLAX = new PublicKey(process.env.TSLAX_MINT);
  const PYTH = new PublicKey(process.env.PYTH_PRICE_FEED || "FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9");
  const [vaultState] = PublicKey.findProgramAddressSync([Buffer.from("vault"), TSLAX.toBuffer()], program.programId);
  const [authority] = PublicKey.findProgramAddressSync([Buffer.from("vault-authority"), TSLAX.toBuffer()], program.programId);
  const [receiptMint] = PublicKey.findProgramAddressSync([Buffer.from("receipt-mint"), TSLAX.toBuffer()], program.programId);
  const MARKET = new PublicKey(process.env.KAMINO_MARKET);
  const RESERVE = new PublicKey(process.env.KAMINO_RESERVE);
  const CTOKEN = new PublicKey(process.env.KAMINO_CTOKEN_MINT);
  const KLEND = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
  const [marketAuth] = PublicKey.findProgramAddressSync([Buffer.from("lma"), MARKET.toBuffer()], KLEND);
  const SUPPLY = new PublicKey(process.env.KAMINO_SUPPLY_VAULT);

  console.log("vaultState:", vaultState.toBase58());
  console.log("authority:", authority.toBase58());
  console.log("pyth_price_feed:", PYTH.toBase58());

  // Step 1: Allocate 272 bytes at the PDA using system program
  // SystemInstruction::Allocate = 8
  const allocDisc = Buffer.from([8, 0, 0, 0, 0, 0, 0, 0]); // u64 272 in LE
  const allocData = Buffer.alloc(1 + 8);
  allocData[0] = 8; // SystemInstruction::Allocate
  allocData.writeBigUInt64LE(BigInt(272), 1);
  
  const allocIx = new TransactionInstruction({
    programId: SystemProgram.programId,
    keys: [
      { pubkey: vaultState, isSigner: false, isWritable: true },
    ],
    data: allocData,
  });
  
  // Need to sign with PDA seeds
  const allocTx = new Transaction().add(allocIx);
  allocTx.feePayer = admin.publicKey;
  allocTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  
  // Can't sign PDA directly from client, need to invoke via program
  // Instead, let's use the program to do the allocation
  console.log("Step 1: Allocate via program's migrate_state (which calls system program)");
  
  // Actually, let's just call initialize_state_v2 which will create new PDA
  // But we want to keep the original vault PDA address...
  
  // Alternative: Use system program Assign to reassign ownership, then Allocate
  // But PDA is owned by our program, not system program
  
  // Best approach: Call a new instruction that does the allocation internally
  // Let's add an allocate instruction to the program
  
  console.log("This needs a program instruction that calls system_program::allocate");
  console.log("Skipping - need to add allocate instruction to program first");
  process.exit(1);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });