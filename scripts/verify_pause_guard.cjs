const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const SYSVAR_IX = new PublicKey("Sysvar1nstructions1111111111111111111111111");
const KLEND = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

async function main() {
  const mode = process.argv[2] || "unpause";
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault;
  const conn = program.provider.connection;
  const admin = provider.wallet;
  const TSLAX = new PublicKey(process.env.TSLAX_MINT);
  const MARKET = new PublicKey(process.env.KAMINO_MARKET);
  const RESERVE = new PublicKey(process.env.KAMINO_RESERVE);
  const CTOKEN = new PublicKey(process.env.KAMINO_CTOKEN_MINT);
  const SUPPLY = new PublicKey(process.env.KAMINO_SUPPLY_VAULT);
  const [vs] = PublicKey.findProgramAddressSync([Buffer.from("vault-v2"), TSLAX.toBuffer()], program.programId);
  const [auth] = PublicKey.findProgramAddressSync([Buffer.from("vault-v2-authority"), TSLAX.toBuffer()], program.programId);
  const [rm] = PublicKey.findProgramAddressSync([Buffer.from("receipt-mint-v2"), TSLAX.toBuffer()], program.programId);
  const [vt] = PublicKey.findProgramAddressSync([Buffer.from("vault-v2-tslax"), TSLAX.toBuffer()], program.programId);
  const [vc] = PublicKey.findProgramAddressSync([Buffer.from("vault-v2-ctoken"), TSLAX.toBuffer()], program.programId);
  const [lma] = PublicKey.findProgramAddressSync([Buffer.from("lma"), MARKET.toBuffer()], KLEND);

  if (mode === "unpause") {
    await program.methods.setPaused(false).accounts({ admin: admin.publicKey, vaultState: vs }).rpc();
    const s = await program.account.vaultState.fetch(vs);
    console.log("isPaused:", s.isPaused);
    return;
  }

  if (mode === "paused-deposit") {
    await program.methods.setPaused(true).accounts({ admin: admin.publicKey, vaultState: vs }).rpc();
    const userTslax = getAssociatedTokenAddressSync(TSLAX, admin.publicKey);
    const userReceipt = getAssociatedTokenAddressSync(rm, admin.publicKey);
    const tx = await program.methods
      .deposit(new anchor.BN(1000000))
      .accounts({
        user: admin.publicKey, vaultState: vs, vaultAuthority: auth,
        userTslax, vaultTslax: vt, vaultCtoken: vc, receiptMint: rm, userReceipt,
        kaminoMarket: MARKET, kaminoReserve: RESERVE, lendingMarketAuthority: lma,
        reserveLiquidityMint: TSLAX, reserveLiquiditySupply: SUPPLY,
        reserveCollateralMint: CTOKEN, kaminoProgram: KLEND,
        tokenProgram: TOKEN_PROGRAM_ID, instructionSysvar: SYSVAR_IX,
      })
      .transaction();
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    const sim = await conn.simulateTransaction(tx);
    console.log("SIM ERR:", JSON.stringify(sim.value.err));
    (sim.value.logs || []).filter((l) => /pause|paused|6010|Error/i.test(l)).forEach((l) => console.log("LOG:", l));
    await program.methods.setPaused(false).accounts({ admin: admin.publicKey, vaultState: vs }).rpc();
    const s = await program.account.vaultState.fetch(vs);
    console.log("restored isPaused:", s.isPaused);
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
