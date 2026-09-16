import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import idlJson from "./idl/vault.json";
import {
  KAMINO_CTOKEN_MINT,
  KAMINO_MARKET,
  KAMINO_RESERVE,
  KAMINO_SUPPLY_VAULT,
  KLEND_PROGRAM_ID,
  TSLAX_DECIMALS,
  TSLAX_MINT,
  VAULT_PROGRAM_ID,
  isConfigured,
} from "./config";

export const NOT_DEPLOYED_MSG =
  "Vault program is not deployed yet. Run the Anchor build and deploy first.";

function loadIdl(): Idl {
  const idl = idlJson as unknown as Idl & { _placeholder?: string };
  const names = new Set((idl.instructions ?? []).map((ix) => ix.name));
  if (!names.has("deposit") || !names.has("withdraw")) {
    throw new Error(NOT_DEPLOYED_MSG);
  }
  return idl;
}

export function vaultProgramId(): PublicKey {
  return new PublicKey(VAULT_PROGRAM_ID);
}

export function getProgram(
  connection: Connection,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wallet: any
): Program {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  } as unknown as ConstructorParameters<typeof AnchorProvider>[2]);
  return new Program(loadIdl(), provider);
}

export type VaultAddresses = {
  vaultState: PublicKey;
  authority: PublicKey;
  receiptMint: PublicKey;
  vaultTslax: PublicKey;
  vaultCtoken: PublicKey;
  marketAuthority: PublicKey;
};

export function deriveAddresses(): VaultAddresses {
  if (!isConfigured()) throw new Error("Vault addresses are not configured.");
  const programId = vaultProgramId();
  const tslax = new PublicKey(TSLAX_MINT);
  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-v2"), tslax.toBuffer()],
    programId
  );
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-v2-authority"), tslax.toBuffer()],
    programId
  );
  const [receiptMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt-mint-v2"), tslax.toBuffer()],
    programId
  );
  const [vaultTslax] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-v2-tslax"), tslax.toBuffer()],
    programId
  );
  const [vaultCtoken] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-v2-ctoken"), tslax.toBuffer()],
    programId
  );
  const [marketAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("lma"), new PublicKey(KAMINO_MARKET).toBuffer()],
    new PublicKey(KLEND_PROGRAM_ID)
  );
  return { vaultState, authority, receiptMint, vaultTslax, vaultCtoken, marketAuthority };
}

/** Token balance in base units, or null when the account does not exist. */
export async function tokenBalance(
  connection: Connection,
  ata: PublicKey
): Promise<bigint | null> {
  const acc = await connection.getTokenAccountBalance(ata).catch(() => null);
  return acc ? BigInt(acc.value.amount) : null;
}

export function toBaseUnits(uiAmount: number): bigint {
  return BigInt(Math.floor(uiAmount * 10 ** TSLAX_DECIMALS));
}

export function toUiAmount(baseUnits: bigint): number {
  return Number(baseUnits) / 10 ** TSLAX_DECIMALS;
}

/** ATA creation instruction, or null when the account already exists. */
export async function maybeCreateAtaIx(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<{ ata: PublicKey; ix: TransactionInstruction | null }> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const info = await connection.getAccountInfo(ata);
  if (info) return { ata, ix: null };
  return {
    ata,
    ix: createAssociatedTokenAccountInstruction(owner, ata, owner, mint),
  };
}

export async function buildDepositTx(
  program: Program,
  user: PublicKey,
  amountBase: bigint
): Promise<{ tx: Transaction; userReceipt: PublicKey }> {
  const addrs = deriveAddresses();
  const connection = program.provider.connection as Connection;
  const tslaxMint = new PublicKey(TSLAX_MINT);
  const userTslax = getAssociatedTokenAddressSync(tslaxMint, user);
  const { ata: userReceipt, ix: createIx } = await maybeCreateAtaIx(
    connection,
    addrs.receiptMint,
    user
  );
  const depositIx = await program.methods
    .deposit(new BN(amountBase.toString()))
    .accounts({
      user,
      vaultState: addrs.vaultState,
      vaultAuthority: addrs.authority,
      userTslax,
      vaultTslax: addrs.vaultTslax,
      vaultCtoken: addrs.vaultCtoken,
      receiptMint: addrs.receiptMint,
      userReceipt,
      kaminoMarket: new PublicKey(KAMINO_MARKET),
      kaminoReserve: new PublicKey(KAMINO_RESERVE),
      lendingMarketAuthority: addrs.marketAuthority,
      reserveLiquidityMint: tslaxMint,
      reserveLiquiditySupply: new PublicKey(KAMINO_SUPPLY_VAULT),
      reserveCollateralMint: new PublicKey(KAMINO_CTOKEN_MINT),
      kaminoProgram: new PublicKey(KLEND_PROGRAM_ID),
      tokenProgram: TOKEN_PROGRAM_ID,
      instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .instruction();
  const tx = new Transaction();
  if (createIx) tx.add(createIx);
  tx.add(depositIx);
  return { tx, userReceipt };
}

export async function buildWithdrawTx(
  program: Program,
  user: PublicKey,
  sharesBase: bigint
): Promise<Transaction> {
  const addrs = deriveAddresses();
  const tslaxMint = new PublicKey(TSLAX_MINT);
  const userTslax = getAssociatedTokenAddressSync(tslaxMint, user);
  const userReceipt = getAssociatedTokenAddressSync(addrs.receiptMint, user);
  const withdrawIx = await program.methods
    .withdraw(new BN(sharesBase.toString()))
    .accounts({
      user,
      vaultState: addrs.vaultState,
      vaultAuthority: addrs.authority,
      userTslax,
      vaultTslax: addrs.vaultTslax,
      vaultCtoken: addrs.vaultCtoken,
      receiptMint: addrs.receiptMint,
      userReceipt,
      kaminoMarket: new PublicKey(KAMINO_MARKET),
      kaminoReserve: new PublicKey(KAMINO_RESERVE),
      lendingMarketAuthority: addrs.marketAuthority,
      reserveLiquidityMint: tslaxMint,
      reserveLiquiditySupply: new PublicKey(KAMINO_SUPPLY_VAULT),
      reserveCollateralMint: new PublicKey(KAMINO_CTOKEN_MINT),
      kaminoProgram: new PublicKey(KLEND_PROGRAM_ID),
      tokenProgram: TOKEN_PROGRAM_ID,
      instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .instruction();
  return new Transaction().add(withdrawIx);
}

export { ASSOCIATED_TOKEN_PROGRAM_ID };
