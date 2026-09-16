const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram } = require("@solana/web3.js");

async function main() {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Vault;
  const admin = program.provider.wallet;
  const conn = program.provider.connection;
  const TSLAX = new PublicKey(process.env.TSLAX_MINT);
  const PYTH = new PublicKey(process.env.PYTH_PRICE_FEED || "FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9");
  const [vaultState] = PublicKey.findProgramAddressSync([Buffer.from("vault"), TSLAX.toBuffer()], program.programId);
  const [authority] = PublicKey.findProgramAddressSync([Buffer.from("vault-authority"), TSLAX.toBuffer()], program.programId);
  
  console.log("Migrating vault state...");
  console.log("vaultState:", vaultState.toBase58());
  console.log("pyth_price_feed:", PYTH.toBase58());
  
  const sig = await program.methods.migrateState().accounts({
    admin: admin.publicKey,
    vaultState,
    pythPriceFeed: PYTH,
    systemProgram: SystemProgram.programId,
  }).rpc();
  
  console.log("MIGRATE SIG:", sig);
  
  // Verify
  const state = await program.account.vaultState.fetch(vaultState);
  console.log("STATE FETCH OK");
  console.log("is_paused:", state.isPaused);
  console.log("pyth_price_feed:", state.pythPriceFeed.toBase58());
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });