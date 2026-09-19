import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createHash } from "crypto";
import {
  MOCK_LENDER_POOL,
  MOCK_LENDER_PROGRAM_ID,
  MOCK_LENDER_SHARES_MINT,
  PYTH_PRICE_UPDATE,
  TSLAX_DECIMALS,
  TSLAX_MINT,
  VAULT_PROGRAM_ID,
  isConfigured,
} from "./config";
import type { PostedUpdate } from "./pyth";
export const NOT_DEPLOYED_MSG = "Vault is not configured. Check env addresses.";

const SYSVAR_IX = new PublicKey("Sysvar1nstructions1111111111111111111111111");
const ASSOCIATED_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function disc(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

export function vaultProgramId(): PublicKey {
  return new PublicKey(VAULT_PROGRAM_ID);
}

export function priceUpdateAccount(): PublicKey | null {
  if (!PYTH_PRICE_UPDATE) return null;
  return new PublicKey(PYTH_PRICE_UPDATE);
}

export type VaultAddresses = {
  vaultState: PublicKey;
  authority: PublicKey;
  receiptMint: PublicKey;
  treasury: PublicKey;
  vaultTslaxAta: PublicKey;
  vaultSharesAta: PublicKey;
  poolAuthority: PublicKey;
  poolVaultAta: PublicKey;
  mockProgram: PublicKey;
  mockPool: PublicKey;
  sharesMint: PublicKey;
  tslaxMint: PublicKey;
};

/** PDAs + ATAs matching programs/vault Deposit/Withdraw (mock_lender v2 path). */
export function deriveAddresses(): VaultAddresses {
  if (!isConfigured()) throw new Error(NOT_DEPLOYED_MSG);
  const programId = vaultProgramId();
  const tslax = new PublicKey(TSLAX_MINT);
  const mockPool = new PublicKey(MOCK_LENDER_POOL);
  const sharesMint = new PublicKey(MOCK_LENDER_SHARES_MINT);
  const mockProgram = new PublicKey(MOCK_LENDER_PROGRAM_ID);
  const [vaultState] = PublicKey.findProgramAddressSync([Buffer.from("vault-v2"), tslax.toBuffer()], programId);
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-v2-authority"), tslax.toBuffer()],
    programId
  );
  const [receiptMint] = PublicKey.findProgramAddressSync([Buffer.from("receipt"), tslax.toBuffer()], programId);
  const [treasury] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-treasury"), tslax.toBuffer()],
    programId
  );
  const [poolAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), tslax.toBuffer()],
    mockProgram
  );
  const vaultTslaxAta = getAssociatedTokenAddressSync(tslax, authority, true);
  const vaultSharesAta = getAssociatedTokenAddressSync(sharesMint, authority, true);
  const poolVaultAta = getAssociatedTokenAddressSync(tslax, mockPool, true);
  return {
    vaultState,
    authority,
    receiptMint,
    treasury,
    vaultTslaxAta,
    vaultSharesAta,
    poolAuthority,
    poolVaultAta,
    mockProgram,
    mockPool,
    sharesMint,
    tslaxMint: tslax,
  };
}

/** Token balance in base units, or null when the account does not exist. */
export async function tokenBalance(connection: Connection, ata: PublicKey): Promise<bigint | null> {
  const acc = await connection.getTokenAccountBalance(ata).catch(() => null);
  return acc ? BigInt(acc.value.amount) : null;
}

export function toBaseUnits(uiAmount: number): bigint {
  return BigInt(Math.floor(uiAmount * 10 ** TSLAX_DECIMALS));
}

export function toUiAmount(baseUnits: bigint): number {
  return Number(baseUnits) / 10 ** TSLAX_DECIMALS;
}

/** Deposit TSLAx -> mock_lender CPI -> nTSLA. Order mirrors programs/vault Deposit. */
export async function buildDepositTx(
  connection: Connection,
  user: PublicKey,
  amountBase: bigint,
  posted?: PostedUpdate
): Promise<{ tx: Transaction; userReceipt: PublicKey; extraSigners: import("@solana/web3.js").Keypair[] }> {
  const a = deriveAddresses();
  const userTslax = getAssociatedTokenAddressSync(a.tslaxMint, user);
  const userReceipt = getAssociatedTokenAddressSync(a.receiptMint, user);
  void connection;
  const tx = new Transaction();
  if (posted) for (const ix of posted.postInstructions) tx.add(ix);

  const data = Buffer.concat([disc("deposit"), u64le(amountBase)]);
  // price_update is trailing: a fresh Hermes-posted account when available,
  // else the configured placeholder (old deployments ignore the extra account,
  // new ones enforce feed id + 60s staleness — see Task 1 docs).
  const priceUpdate = posted?.priceUpdateAccount ?? priceUpdateAccount();
  const ix = new TransactionInstruction({
    programId: vaultProgramId(),
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: a.vaultState, isSigner: false, isWritable: true },
      { pubkey: a.authority, isSigner: false, isWritable: true },
      { pubkey: userTslax, isSigner: false, isWritable: true },
      { pubkey: a.vaultTslaxAta, isSigner: false, isWritable: true },
      { pubkey: a.tslaxMint, isSigner: false, isWritable: false },
      { pubkey: a.mockPool, isSigner: false, isWritable: true },
      { pubkey: a.sharesMint, isSigner: false, isWritable: true },
      { pubkey: a.vaultSharesAta, isSigner: false, isWritable: true },
      { pubkey: a.receiptMint, isSigner: false, isWritable: true },
      { pubkey: userReceipt, isSigner: false, isWritable: true },
      { pubkey: a.poolVaultAta, isSigner: false, isWritable: true },
      { pubkey: a.mockProgram, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_IX, isSigner: false, isWritable: false },
      ...(priceUpdate
        ? [{ pubkey: priceUpdate, isSigner: false, isWritable: false }]
        : []),
    ],
    data,
  });
  tx.add(ix);
  return { tx, userReceipt, extraSigners: posted?.ephemeralSigners ?? [] };
}

/** Withdraw by nTSLA shares. Order mirrors programs/vault Withdraw. */
export async function buildWithdrawTx(
  connection: Connection,
  user: PublicKey,
  sharesBase: bigint,
  posted?: PostedUpdate
): Promise<{ tx: Transaction; extraSigners: import("@solana/web3.js").Keypair[] }> {
  const a = deriveAddresses();
  const userTslax = getAssociatedTokenAddressSync(a.tslaxMint, user);
  const userReceipt = getAssociatedTokenAddressSync(a.receiptMint, user);
  void connection;
  const data = Buffer.concat([disc("withdraw"), u64le(sharesBase)]);
  const priceUpdate = posted?.priceUpdateAccount ?? priceUpdateAccount();
  const ix = new TransactionInstruction({
    programId: vaultProgramId(),
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: a.vaultState, isSigner: false, isWritable: true },
      { pubkey: a.authority, isSigner: false, isWritable: true },
      { pubkey: userTslax, isSigner: false, isWritable: true },
      { pubkey: a.vaultTslaxAta, isSigner: false, isWritable: true },
      { pubkey: a.receiptMint, isSigner: false, isWritable: true },
      { pubkey: userReceipt, isSigner: false, isWritable: true },
      { pubkey: a.tslaxMint, isSigner: false, isWritable: false },
      { pubkey: a.mockPool, isSigner: false, isWritable: true },
      { pubkey: a.sharesMint, isSigner: false, isWritable: true },
      { pubkey: a.vaultSharesAta, isSigner: false, isWritable: true },
      { pubkey: a.poolVaultAta, isSigner: false, isWritable: true },
      { pubkey: a.treasury, isSigner: false, isWritable: true },
      { pubkey: a.mockProgram, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_IX, isSigner: false, isWritable: false },
      ...(priceUpdate
        ? [{ pubkey: priceUpdate, isSigner: false, isWritable: false }]
        : []),
    ],
    data,
  });
  const tx = new Transaction();
  if (posted) for (const ix of posted.postInstructions) tx.add(ix);
  tx.add(ix);
  return { tx, extraSigners: posted?.ephemeralSigners ?? [] };
}

export { ASSOCIATED_TOKEN_PROGRAM_ID };
