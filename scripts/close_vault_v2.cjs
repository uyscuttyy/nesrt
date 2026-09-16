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
  const [vaultStateV2] = PublicKey.findProgramAddressSync([Buffer.from("vault-v2"), TSLAX.toBuffer()], program.programId);
  
  console.log("Closing vault-v2 state via close_vault_state_v2...");
  console.log("vaultStateV2:", vaultStateV2.toBase58());
  
  // closeVaultStateV2 discriminator: global:close_vault_state_v2
  const crypto = require('crypto');
  const disc_bytes = crypto.createHash('sha256').update('global:close_vault_state_v2').digest().slice(0, 8);
  console.log("discriminator:", Array.from(disc_bytes));
  
  const disc = Buffer.from(disc_bytes);
  const keys = [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: vaultStateV2, isSigner: false, isWritable: true },
    { pubkey: TSLAX, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const ix = new TransactionInstruction({ programId: program.programId, keys, data: Buffer.from(disc_bytes) });
  const tx = new Transaction().add(ix);
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  
  const sig = await provider.sendAndConfirm(tx);
  console.log("CLOSE-V2 SIG:", sig);
  
  // Check account is closed
  const info = await conn.getAccountInfo(vaultStateV2);
  console.log("Account exists after close:", !!info);
  if (info) {
    console.log("Data length:", info.data.length);
    console.log("First 8 bytes:", Array.from(info.data.slice(0, 8)));
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });