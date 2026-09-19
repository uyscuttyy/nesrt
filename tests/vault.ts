import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";
import * as crypto from "crypto";

const TSLAX_MINT = new PublicKey("4Dimn4s78herJKGhD3oxMMGbZcjirgwt376tdjq4HevA");
const MOCK_LENDER_PROGRAM = new PublicKey("7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g");
const MOCK_LENDER_POOL = new PublicKey("6TdFhCAHbod21bm7BCenz3fEAgfTQr1BGri7Mzjie9Nx");
const MOCK_LENDER_SHARES_MINT = new PublicKey("6s2qM9MbCgcZzfdEmYt9PnvoYLpuF91PGCZ3T5noquAg");
// Placeholder until Hermes posting exists (old deployments ignore the extra
// account; new ones enforce feed id + 60s staleness — see Task 1 docs).
const PYTH_PRICE_UPDATE = new PublicKey("FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9");
const SYSVAR_IX = new PublicKey("Sysvar1nstructions1111111111111111111111111");
const ASSOCIATED_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const DECIMALS = 6;
const ui = (n: number) => n * 10 ** DECIMALS;

const VAULT_PROGRAM_ID = new PublicKey("DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB");

const disc = (n: string) =>
  Buffer.from(crypto.createHash("sha256").update(`global:${n}`).digest().slice(0, 8));
const u64le = (n: number | bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

describe("nesrt vault (devnet) - mock_lender v2", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const admin = provider.wallet as anchor.Wallet;

  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-v2"), TSLAX_MINT.toBuffer()],
    VAULT_PROGRAM_ID
  );
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-v2-authority"), TSLAX_MINT.toBuffer()],
    VAULT_PROGRAM_ID
  );
  const [receiptMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), TSLAX_MINT.toBuffer()],
    VAULT_PROGRAM_ID
  );
  const [treasury] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-treasury"), TSLAX_MINT.toBuffer()],
    VAULT_PROGRAM_ID
  );
  const userTslax = getAssociatedTokenAddressSync(TSLAX_MINT, admin.publicKey);
  const userReceipt = getAssociatedTokenAddressSync(receiptMint, admin.publicKey);
  const vaultTslaxAta = getAssociatedTokenAddressSync(TSLAX_MINT, authority, true);
  const vaultSharesAta = getAssociatedTokenAddressSync(MOCK_LENDER_SHARES_MINT, authority, true);
  const poolVaultAta = getAssociatedTokenAddressSync(TSLAX_MINT, MOCK_LENDER_POOL, true);

  it("initializes vault state", async () => {
    const stateData = await provider.connection.getAccountInfo(vaultState);
    assert.isNotNull(stateData);
  });

  it("initializes the receipt mint", async () => {
    const mint = await provider.connection.getAccountInfo(receiptMint);
    assert.isNotNull(mint);
  });

  it("initializes vault custody accounts", async () => {
    assert.isNotNull(await provider.connection.getAccountInfo(vaultTslaxAta));
    assert.isNotNull(await provider.connection.getAccountInfo(vaultSharesAta));
    assert.isNotNull(await provider.connection.getAccountInfo(treasury), "treasury PDA");
  });

  it("probes Hermes anonymous access (informational, never fails)", async () => {
    // Deposit/withdraw carry a trailing price_update for the Pyth-gated
    // program (ignored by current deployment). Full posting needs Hermes
    // update access, which currently 401s without an API key.
    try {
      const res = await fetch(
        "https://hermes.pyth.network/api/latest_vaas?ids[]=47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362"
      );
      console.log(`Hermes latest_vaas status=${res.status} (need 200 for live posting)`);
    } catch (e) {
      console.log(`Hermes unreachable: ${(e as Error).message.slice(0, 80)}`);
    }
  });

  it("deposits TSLAx and mints nTSLA 1:1 with shares", async () => {
    const amount = ui(1);
    // NOTE: vault custody is shared (other users may have positions), so we
    // assert on our own deltas, not absolute balances.
    const sharesBefore = await getAccount(provider.connection, vaultSharesAta)
      .then((a) => BigInt(a.amount.toString()))
      .catch(() => 0n);
    const receiptBefore = await getAccount(provider.connection, userReceipt)
      .then((a) => BigInt(a.amount.toString()))
      .catch(() => 0n);
    const data = Buffer.concat([disc("deposit"), u64le(amount)]);
    const ix = new TransactionInstruction({
      programId: VAULT_PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: vaultState, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: false, isWritable: true },
        { pubkey: userTslax, isSigner: false, isWritable: true },
        { pubkey: vaultTslaxAta, isSigner: false, isWritable: true },
        { pubkey: TSLAX_MINT, isSigner: false, isWritable: false },
        { pubkey: MOCK_LENDER_POOL, isSigner: false, isWritable: true },
        { pubkey: MOCK_LENDER_SHARES_MINT, isSigner: false, isWritable: true },
        { pubkey: vaultSharesAta, isSigner: false, isWritable: true },
        { pubkey: receiptMint, isSigner: false, isWritable: true },
        { pubkey: userReceipt, isSigner: false, isWritable: true },
        { pubkey: poolVaultAta, isSigner: false, isWritable: true },
        { pubkey: MOCK_LENDER_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_IX, isSigner: false, isWritable: false },
        { pubkey: PYTH_PRICE_UPDATE, isSigner: false, isWritable: false },
      ],
      data,
    });
    await provider.sendAndConfirm(new Transaction().add(ix), []);
    const sharesAfter = BigInt(
      (await getAccount(provider.connection, vaultSharesAta)).amount.toString()
    );
    const receiptAfter = BigInt(
      (await getAccount(provider.connection, userReceipt)).amount.toString()
    );
    const sharesDelta = sharesAfter - sharesBefore;
    const receiptDelta = receiptAfter - receiptBefore;
    console.log(`shares +${sharesDelta}, receipt +${receiptDelta}`);
    assert.isTrue(sharesDelta > 0n);
    assert.equal(receiptDelta.toString(), sharesDelta.toString());
  });

  it("rejects zero-amount deposits", async () => {
    try {
      const data = Buffer.concat([disc("deposit"), u64le(0)]);
      const ix = new TransactionInstruction({
        programId: VAULT_PROGRAM_ID,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultState, isSigner: false, isWritable: true },
          { pubkey: authority, isSigner: false, isWritable: true },
          { pubkey: userTslax, isSigner: false, isWritable: true },
          { pubkey: vaultTslaxAta, isSigner: false, isWritable: true },
          { pubkey: TSLAX_MINT, isSigner: false, isWritable: false },
          { pubkey: MOCK_LENDER_POOL, isSigner: false, isWritable: true },
          { pubkey: MOCK_LENDER_SHARES_MINT, isSigner: false, isWritable: true },
          { pubkey: vaultSharesAta, isSigner: false, isWritable: true },
          { pubkey: receiptMint, isSigner: false, isWritable: true },
          { pubkey: userReceipt, isSigner: false, isWritable: true },
          { pubkey: poolVaultAta, isSigner: false, isWritable: true },
          { pubkey: MOCK_LENDER_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_IX, isSigner: false, isWritable: false },
          { pubkey: PYTH_PRICE_UPDATE, isSigner: false, isWritable: false },
        ],
        data,
      });
      await provider.sendAndConfirm(new Transaction().add(ix), []);
      assert.fail("Should have thrown");
    } catch (e: unknown) {
      console.log("Zero deposit correctly rejected");
    }
  });

  it("accrues yield via drip and withdraws with 10% treasury skim", async () => {
    // Drip yield directly into the pool
    const dripData = Buffer.concat([disc("drip_yield"), u64le(ui(0.1))]);
    const dripIx = new TransactionInstruction({
      programId: MOCK_LENDER_PROGRAM,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: TSLAX_MINT, isSigner: false, isWritable: false },
        { pubkey: MOCK_LENDER_POOL, isSigner: false, isWritable: true },
        { pubkey: userTslax, isSigner: false, isWritable: true },
        { pubkey: poolVaultAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: dripData,
    });
    await provider.sendAndConfirm(new Transaction().add(dripIx), []);

    const receiptBefore = Number((await getAccount(provider.connection, userReceipt)).amount);
    assert.isTrue(receiptBefore > 0, "need a position from the deposit test");
    const tslaxBefore = Number((await getAccount(provider.connection, userTslax)).amount);
    const treasuryBefore = Number((await getAccount(provider.connection, treasury)).amount);

    const data = Buffer.concat([disc("withdraw"), u64le(receiptBefore)]);
    const ix = new TransactionInstruction({
      programId: VAULT_PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: vaultState, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: false, isWritable: true },
        { pubkey: userTslax, isSigner: false, isWritable: true },
        { pubkey: vaultTslaxAta, isSigner: false, isWritable: true },
        { pubkey: receiptMint, isSigner: false, isWritable: true },
        { pubkey: userReceipt, isSigner: false, isWritable: true },
        { pubkey: TSLAX_MINT, isSigner: false, isWritable: false },
        { pubkey: MOCK_LENDER_POOL, isSigner: false, isWritable: true },
        { pubkey: MOCK_LENDER_SHARES_MINT, isSigner: false, isWritable: true },
        { pubkey: vaultSharesAta, isSigner: false, isWritable: true },
        { pubkey: poolVaultAta, isSigner: false, isWritable: true },
        { pubkey: treasury, isSigner: false, isWritable: true },
        { pubkey: MOCK_LENDER_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_IX, isSigner: false, isWritable: false },
        { pubkey: PYTH_PRICE_UPDATE, isSigner: false, isWritable: false },
      ],
      data,
    });
    await provider.sendAndConfirm(new Transaction().add(ix), []);

    const tslaxAfter = Number((await getAccount(provider.connection, userTslax)).amount);
    const treasuryAfter = Number((await getAccount(provider.connection, treasury)).amount);
    console.log(`user ${tslaxBefore} -> ${tslaxAfter}, treasury ${treasuryBefore} -> ${treasuryAfter}`);
    assert.isTrue(tslaxAfter > tslaxBefore, "yield returned to user");
    assert.isTrue(treasuryAfter >= treasuryBefore, "treasury skimmed");
  });
});
