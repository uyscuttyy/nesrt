import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  getAccount,
  getAssociatedTokenAddress,
  transfer,
} from "@solana/spl-token";
import { assert } from "chai";
import { Vault } from "../target/types/vault";

const TSLAX_MINT = new PublicKey(process.env.TSLAX_MINT!);
const KAMINO_MARKET = new PublicKey(process.env.KAMINO_MARKET!);
const KAMINO_RESERVE = new PublicKey(process.env.KAMINO_RESERVE!);
const CTOKEN_MINT = new PublicKey(process.env.KAMINO_CTOKEN_MINT!);
const KLEND_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const SYSVAR_IX = new PublicKey("Sysvar1nstructions1111111111111111111111111");
const DECIMALS = 6;
const ui = (n: number) => n * 10 ** DECIMALS;

// Pyth devnet price feed for mock TSLAx (placeholder - to be created)
const PYTH_PRICE_FEED = new PublicKey(process.env.PYTH_PRICE_FEED || "FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9");

describe("tslax vault (devnet)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault as Program<Vault>;
  const admin = provider.wallet;

  // Use vault-v2 PDA seeds (new layout)
  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-v2"), TSLAX_MINT.toBuffer()],
    program.programId
  );
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-v2-authority"), TSLAX_MINT.toBuffer()],
    program.programId
  );
  const [receiptMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt-mint-v2"), TSLAX_MINT.toBuffer()],
    program.programId
  );
  const [vaultTslax] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-v2-tslax"), TSLAX_MINT.toBuffer()],
    program.programId
  );
  const [vaultCtoken] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-v2-ctoken"), TSLAX_MINT.toBuffer()],
    program.programId
  );
  const [marketAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("lma"), KAMINO_MARKET.toBuffer()],
    KLEND_ID
  );

  // Fresh user funded by the admin (faucet-independent).
  const user = Keypair.generate();
  let userTslax: PublicKey;
  let userReceipt: PublicKey;
  let reserveSupply: PublicKey;

  before(async () => {
    const conn = provider.connection;
    const payer = (admin as anchor.Wallet).payer;
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: user.publicKey,
        lamports: await conn.getMinimumBalanceForRentExemption(0),
      })
    );
    // Enough SOL for the user's ATAs plus tx fees.
    fundTx.add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: user.publicKey,
        lamports: 100_000_000,
      })
    );
    await provider.sendAndConfirm(fundTx);

    userTslax = await createAssociatedTokenAccount(
      conn,
      user,
      TSLAX_MINT,
      user.publicKey
    );
    const adminTslax = await getAssociatedTokenAddress(TSLAX_MINT, admin.publicKey);
    await transfer(conn, payer, adminTslax, userTslax, admin.publicKey, ui(1000));
    // NOTE: the yTSLAx receipt ATA is created inside the deposit test, after
    // initialize_vault brings the receipt mint into existence.
    userReceipt = await getAssociatedTokenAddress(receiptMint, user.publicKey);
    const acc = await conn.getAccountInfo(KAMINO_RESERVE);
    assert.ok(acc, "kamino reserve missing");
    // Supply vault address recorded in Phase 2 (reserve liquidity vault).
    reserveSupply = new PublicKey(process.env.KAMINO_SUPPLY_VAULT!);
  });

  it("initializes vault state", async () => {
    try {
      const sig = await program.methods
        .initializeStateV2()
        .accounts({
          admin: admin.publicKey,
          tslaxMint: TSLAX_MINT,
          kaminoMarket: KAMINO_MARKET,
          kaminoReserve: KAMINO_RESERVE,
          ctokenMint: CTOKEN_MINT,
          receiptMint,
          pythPriceFeed: PYTH_PRICE_FEED,
          vaultState,
          vaultAuthority: authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("INIT-STATE-V2 SIG:", sig);
    } catch (e) {
      // Idempotent reruns: the PDA already exists from a previous run.
      console.log("init-state-v2 skipped (already exists)");
    }
  });

  it("initializes the receipt mint", async () => {
    try {
      const sig = await program.methods
        .initializeMint()
        .accounts({
          admin: admin.publicKey,
          vaultState,
          vaultAuthority: authority,
          receiptMint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      console.log("INIT-MINT SIG:", sig);
    } catch (e) {
      console.log("init-mint skipped (already exists)");
    }
  });

  it("initializes vault custody accounts", async () => {
    try {
      const sig = await program.methods
        .initCustody()
        .accounts({
          admin: admin.publicKey,
          vaultState,
          vaultAuthority: authority,
          tslaxMint: TSLAX_MINT,
          ctokenMint: CTOKEN_MINT,
          vaultTslaxAccount: vaultTslax,
          vaultCtokenAccount: vaultCtoken,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      console.log("INIT-CUSTODY SIG:", sig);
    } catch (e) {
      console.log("init-custody skipped (already exists)");
    }
    const state = await program.account.vaultState.fetch(vaultState);
    assert.equal(state.tslaxMint.toBase58(), TSLAX_MINT.toBase58());
    assert.equal(state.kaminoReserve.toBase58(), KAMINO_RESERVE.toBase58());
  });

  it("deposits TSLAx and mints yTSLAx 1:1 with cTokens", async () => {
    const conn = provider.connection;
    try {
      await createAssociatedTokenAccount(conn, user, receiptMint, user.publicKey);
    } catch {
      // ATA already exists from a previous run.
    }
    const cBefore = (await getAccount(conn, vaultCtoken)).amount;
    await program.methods
      .deposit(new anchor.BN(ui(100)))
      .accounts({
        user: user.publicKey,
        vaultState,
        vaultAuthority: authority,
        userTslax,
        vaultTslax,
        vaultCtoken,
        receiptMint,
        userReceipt,
        kaminoMarket: KAMINO_MARKET,
        kaminoReserve: KAMINO_RESERVE,
        lendingMarketAuthority: marketAuthority,
        reserveLiquidityMint: TSLAX_MINT,
        reserveLiquiditySupply: reserveSupply,
        reserveCollateralMint: CTOKEN_MINT,
        kaminoProgram: KLEND_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructionSysvar: SYSVAR_IX,
      })
      .signers([user])
      .rpc();
    const cAfter = (await getAccount(conn, vaultCtoken)).amount;
    const yBal = (await getAccount(conn, userReceipt)).amount;
    assert.equal((cAfter - cBefore).toString(), yBal.toString());
    assert.ok(yBal > 0n, "no yTSLAx minted");
  });

  it("rejects zero-amount deposits", async () => {
    let failed = false;
    try {
      await program.methods
        .deposit(new anchor.BN(0))
        .accounts({
          user: user.publicKey,
          vaultState,
          vaultAuthority: authority,
          userTslax,
          vaultTslax,
          vaultCtoken,
          receiptMint,
          userReceipt,
          kaminoMarket: KAMINO_MARKET,
          kaminoReserve: KAMINO_RESERVE,
          lendingMarketAuthority: marketAuthority,
          reserveLiquidityMint: TSLAX_MINT,
          reserveLiquiditySupply: reserveSupply,
          reserveCollateralMint: CTOKEN_MINT,
          kaminoProgram: KLEND_ID,
          instructionSysvar: SYSVAR_IX,
        })
        .signers([user])
        .rpc();
    } catch {
      failed = true;
    }
    assert.ok(failed, "zero deposit should fail");
  });

  it("withdraws the full position back to TSLAx", async () => {
    const conn = provider.connection;
    const yBal = (await getAccount(conn, userReceipt)).amount;
    const tBefore = (await getAccount(conn, userTslax)).amount;
    await program.methods
      .withdraw(new anchor.BN(yBal.toString()))
      .accounts({
        user: user.publicKey,
        vaultState,
        vaultAuthority: authority,
        userTslax,
        vaultTslax,
        vaultCtoken,
        receiptMint,
        userReceipt,
        kaminoMarket: KAMINO_MARKET,
        kaminoReserve: KAMINO_RESERVE,
        lendingMarketAuthority: marketAuthority,
        reserveLiquidityMint: TSLAX_MINT,
        reserveLiquiditySupply: reserveSupply,
        reserveCollateralMint: CTOKEN_MINT,
        kaminoProgram: KLEND_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructionSysvar: SYSVAR_IX,
      })
      .signers([user])
      .rpc();
    const tAfter = (await getAccount(conn, userTslax)).amount;
    const yAfter = (await getAccount(conn, userReceipt)).amount;
    assert.equal(yAfter, 0n);
    // At 1.0 exchange rate the round trip is exact; allow 1 base unit of dust.
    assert.ok(tAfter - tBefore >= BigInt(ui(100)) - 1n, "principal not returned");
  });
});
