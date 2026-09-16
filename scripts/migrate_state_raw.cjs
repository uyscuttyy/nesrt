const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram, Transaction, TransactionInstruction } = require("@solana/web3.js");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault;
  const admin = provider.wallet;
  const conn = provider.connection;
  const TSLAX = new PublicKey(process.env.TSLAX_MINT);
  const PYTH = new PublicKey(process.env.PYTH_PRICE_FEED || "FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9");
  const [vaultState] = PublicKey.findProgramAddressSync([Buffer.from("vault"), TSLAX.toBuffer()], program.programId);
  const [authority] = PublicKey.findProgramAddressSync([Buffer.from("vault-authority"), TSLAX.toBuffer()], program.programId);
  
  console.log("Migrating vault state via raw instruction...");
  console.log("vaultState:", vaultState.toBase58());
  console.log("pyth_price_feed:", PYTH.toBase58());
  
  // migrateState discriminator: global:migrate_state = [34, 189, 226, 222, 218, 156, 19, 213]
  const disc = Buffer.from([34, 189, 226, 222, 218, 156, 19, 213]);
  const keys = [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: vaultState, isSigner: false, isWritable: true },
    { pubkey: TSLAX, isSigner: false, isWritable: false },
    { pubkey: PYTH, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const ix = new TransactionInstruction({ programId: program.programId, keys, data: disc });
  const tx = new Transaction().add(ix);
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  
  const sig = await provider.sendAndConfirm(tx);
  console.log("MIGRATE SIG:", sig);
  
  // Verify
  const state = await program.account.vaultState.fetch(vaultState);
  console.log("STATE FETCH OK");
  console.log("is_paused:", state.isPaused);
  console.log("pyth_price_feed:", state.pythPriceFeed.toBase58());
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });