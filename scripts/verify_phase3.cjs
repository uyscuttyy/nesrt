const anchor = require("@coral-xyz/anchor");
const { PublicKey } = require("@solana/web3.js");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault;
  const admin = provider.wallet;
  const TSLAX = new PublicKey(process.env.TSLAX_MINT);
  const [vs] = PublicKey.findProgramAddressSync([Buffer.from("vault-v2"), TSLAX.toBuffer()], program.programId);

  let sig = await program.methods.setPaused(true).accounts({ admin: admin.publicKey, vaultState: vs }).rpc();
  console.log("PAUSE SIG:", sig);
  let s = await program.account.vaultState.fetch(vs);
  console.log("isPaused after pause:", s.isPaused);

  sig = await program.methods.setPaused(false).accounts({ admin: admin.publicKey, vaultState: vs }).rpc();
  console.log("UNPAUSE SIG:", sig);
  s = await program.account.vaultState.fetch(vs);
  console.log("isPaused after unpause:", s.isPaused);

  sig = await program.methods.setAdmin().accounts({ admin: admin.publicKey, newAdmin: admin.publicKey, vaultState: vs }).rpc();
  console.log("SET-ADMIN SIG:", sig);
  s = await program.account.vaultState.fetch(vs);
  console.log("admin after setAdmin:", s.admin.toBase58());
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
