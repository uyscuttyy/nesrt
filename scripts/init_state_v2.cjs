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
  const CTOKEN = new PublicKey(process.env.KAMINO_CTOKEN_MINT);
  const MARKET = new PublicKey(process.env.KAMINO_MARKET);
  const RESERVE = new PublicKey(process.env.KAMINO_RESERVE);
  const RECEIPT = new PublicKey("7zbpLvXSXipfgFn4XJeZWbw2F2nHaoAmMaJTPebiTpoU"); // receipt mint from Phase 2
  
  // New PDA seeds: "vault-v2" and "vault-v2-authority"
  const [vaultStateV2] = PublicKey.findProgramAddressSync([Buffer.from("vault-v2"), TSLAX.toBuffer()], program.programId);
  const [authorityV2] = PublicKey.findProgramAddressSync([Buffer.from("vault-v2-authority"), TSLAX.toBuffer()], program.programId);
  
  console.log("Initializing vault state v2 with new layout...");
  console.log("vaultStateV2:", vaultStateV2.toBase58());
  console.log("authorityV2:", authorityV2.toBase58());
  console.log("pyth_price_feed:", process.env.PYTH_PRICE_FEED || "FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9");
  
  // initializeStateV2 discriminator: global:initialize_state_v2
  const crypto = require('crypto');
  const disc_bytes = crypto.createHash('sha256').update('global:initialize_state_v2').digest().slice(0, 8);
  console.log("discriminator:", Array.from(disc_bytes));
  
  const disc = Buffer.from(disc_bytes);
  const keys = [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: TSLAX, isSigner: false, isWritable: false },
    { pubkey: MARKET, isSigner: false, isWritable: false },
    { pubkey: RESERVE, isSigner: false, isWritable: false },
    { pubkey: CTOKEN, isSigner: false, isWritable: false },
    { pubkey: RECEIPT, isSigner: false, isWritable: false },
    { pubkey: PYTH, isSigner: false, isWritable: false },
    { pubkey: vaultStateV2, isSigner: false, isWritable: true },
    { pubkey: authorityV2, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const ix = new TransactionInstruction({ programId: program.programId, keys, data: Buffer.from(disc_bytes) });
  const tx = new Transaction().add(ix);
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  
  const sig = await provider.sendAndConfirm(tx);
  console.log("INIT-STATE-V2 SIG:", sig);
  
  // Now check the account has new layout
  const info = await conn.getAccountInfo(vaultStateV2);
  console.log("Account exists after init:", !!info);
  if (info) {
    console.log("Data length:", info.data.length);
    console.log("First 8 bytes (discriminator):", Array.from(info.data.slice(0, 8)));
  }
  
  // Verify via program
  const state = await program.account.vaultState.fetch(vaultStateV2);
  console.log("STATE FETCH OK");
  console.log("is_paused:", state.isPaused);
  console.log("pyth_price_feed:", state.pythPriceFeed.toBase58());
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });