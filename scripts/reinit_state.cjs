const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram, Transaction, TransactionInstruction } = require("@solana/web3.js");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault;
  const admin = program.provider.wallet;
  const conn = program.provider.connection;
  const TSLAX = new PublicKey(process.env.TSLAX_MINT);
  const CTOKEN = new PublicKey(process.env.KAMINO_CTOKEN_MINT);
  const MARKET = new PublicKey(process.env.KAMINO_MARKET);
  const RESERVE = new PublicKey(process.env.KAMINO_RESERVE);
  const PYTH = new PublicKey(process.env.PYTH_PRICE_FEED || "FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9");
  const [vaultState] = PublicKey.findProgramAddressSync([Buffer.from("vault"), TSLAX.toBuffer()], program.programId);
  const [authority] = PublicKey.findProgramAddressSync([Buffer.from("vault-authority"), TSLAX.toBuffer()], program.programId);
  const [receiptMint] = PublicKey.findProgramAddressSync([Buffer.from("receipt-mint"), TSLAX.toBuffer()], program.programId);
  
  console.log("Re-initializing vault state with new layout...");
  console.log("vaultState:", vaultState.toBase58());
  console.log("pyth_price_feed:", process.env.PYTH_PRICE_FEED || "FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9");
  
  // initializeState discriminator: global:initialize_state = [190, 171, 224, 219, 217, 72, 199, 176]
  const disc = Buffer.from([190, 171, 224, 219, 217, 72, 199, 176]);
  const keys = [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: TSLAX, isSigner: false, isWritable: false },
    { pubkey: MARKET, isSigner: false, isWritable: false },
    { pubkey: RESERVE, isSigner: false, isWritable: false },
    { pubkey: CTOKEN, isSigner: false, isWritable: false },
    { pubkey: receiptMint, isSigner: false, isWritable: false },
    { pubkey: PYTH, isSigner: false, isWritable: false },
    { pubkey: vaultState, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const ix = new TransactionInstruction({ programId: program.programId, keys, data: disc });
  const tx = new Transaction().add(ix);
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  
  const sig = await provider.sendAndConfirm(tx);
  console.log("INIT-STATE SIG:", sig);
  
  // Now check the account has new layout
  const info = await conn.getAccountInfo(vaultState);
  console.log("Account exists after init:", !!info);
  if (info) {
    console.log("Data length:", info.data.length);
    console.log("First 8 bytes (discriminator):", Array.from(info.data.slice(0, 8)));
  }
  
  // Verify via program
  const state = await program.account.vaultState.fetch(vaultState);
  console.log("STATE FETCH OK");
  console.log("is_paused:", state.isPaused);
  console.log("pyth_price_feed:", state.pythPriceFeed.toBase58());
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });