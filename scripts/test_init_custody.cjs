const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, TransactionInstruction } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID } = require("@solana/spl-token");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault;
  const admin = provider.wallet;
  const conn = program.provider.connection;
  const TSLAX = new PublicKey(process.env.TSLAX_MINT);
  const CTOKEN = new PublicKey(process.env.KAMINO_CTOKEN_MINT);
  const [vaultState] = PublicKey.findProgramAddressSync([Buffer.from("vault-v2"), TSLAX.toBuffer()], program.programId);
  const [authority] = PublicKey.findProgramAddressSync([Buffer.from("vault-v2-authority"), TSLAX.toBuffer()], program.programId);
  const [vaultTslax] = PublicKey.findProgramAddressSync([Buffer.from("vault-v2-tslax"), TSLAX.toBuffer()], program.programId);
  const [vaultCtoken] = PublicKey.findProgramAddressSync([Buffer.from("vault-v2-ctoken"), TSLAX.toBuffer()], program.programId);
  
  console.log("Testing initCustody...");
  console.log("vaultState:", vaultState.toBase58());
  console.log("authority:", authority.toBase58());
  console.log("vaultTslax:", vaultTslax.toBase58());
  console.log("vaultCtoken:", vaultCtoken.toBase58());
  
  // Check if accounts exist
  const info1 = await conn.getAccountInfo(vaultTslax);
  const info2 = await conn.getAccountInfo(vaultCtoken);
  console.log("vaultTslax exists:", !!info1);
  console.log("vaultCtoken exists:", !!info2);
  
  // Try initCustody
  const tx = await program.methods.initCustody().accounts({
    admin: admin.publicKey,
    vaultState,
    vaultAuthority: authority,
    tslaxMint: TSLAX,
    ctokenMint: new PublicKey(process.env.KAMINO_CTOKEN_MINT),
    vaultTslaxAccount: vaultTslax,
    vaultCtokenAccount: vaultCtoken,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
  }).transaction();
  
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  
  const sim = await conn.simulateTransaction(tx);
  console.log("SIM ERR:", JSON.stringify(sim.value.err));
  console.log("LOGS:", (sim.value.logs || []).join("\n"));
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });