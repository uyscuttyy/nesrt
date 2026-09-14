/**
 * Phase 2: Devnet environment bootstrap (one-time script).
 *
 *  1. Creates the mock TSLAx SPL mint (6 decimals) + mints supply to admin.
 *  2. Creates a Kamino lending market on devnet (KLend program).
 *  3. Initializes a supply-only TSLAx reserve (LTV 0, borrows disabled).
 *  4. Deposits admin seed liquidity to activate the reserve.
 *  5. Writes all addresses to setup/output/devnet.json
 *
 * Oracle note: a mock asset has no Scope/Pyth feed. The reserve records the
 * admin address as a placeholder Pyth price and disables TWAP, borrowing and
 * LTV. This passes on-chain config validation. The vault flow (deposit /
 * redeem cTokens) never touches an oracle: depositReserveLiquidity and
 * redeemReserveCollateral refresh interest without fetching prices.
 * Consequence, stated plainly: with no possible borrowers, supply APY is 0
 * until a real price feed and borrow demand exist. The cToken exchange rate
 * the frontend reads is still 100% real.
 *
 * Usage:  npm run setup:devnet   (from setup/)
 * Re-runs are safe: completed steps are skipped via setup/output/devnet.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  AssetReserveConfigCli,
  defaultReserveConfig,
  depositReserveLiquidity,
  encodeTokenName,
  KaminoManager,
  lendingMarketAuthPda,
  PROGRAM_ID as KLEND_PROGRAM_ID,
  Reserve,
  DEFAULT_RECENT_SLOT_DURATION_MS,
} from "@kamino-finance/klend-sdk";
// NB: the package root re-exports the *kvault* ReserveConfig/TokenInfo under
// these names, so import the klend codegen types by path for reserve config.
import { ReserveConfig } from "@kamino-finance/klend-sdk/dist/@codegen/klend/types/ReserveConfig.js";
import { TokenInfo } from "@kamino-finance/klend-sdk/dist/@codegen/klend/types/TokenInfo.js";
import { PythConfiguration } from "@kamino-finance/klend-sdk/dist/@codegen/klend/types/PythConfiguration.js";
import { ScopeConfiguration } from "@kamino-finance/klend-sdk/dist/@codegen/klend/types/ScopeConfiguration.js";
import { SwitchboardConfiguration } from "@kamino-finance/klend-sdk/dist/@codegen/klend/types/SwitchboardConfiguration.js";
import { BorrowRateCurve } from "@kamino-finance/klend-sdk/dist/@codegen/klend/types/BorrowRateCurve.js";
import { CurvePoint } from "@kamino-finance/klend-sdk/dist/@codegen/klend/types/CurvePoint.js";
import BN from "bn.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(__dirname, "output", "devnet.json");

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const ADMIN_KEYPAIR = process.env.ADMIN_KEYPAIR ?? path.join(REPO_ROOT, "keypairs", "nesrt-admin.json");
const TSLAX_DECIMALS = 6;
const TSLAX_SUPPLY = 1_000_000; // whole tokens to admin
const SEED_DEPOSIT = 100_000; // whole tokens as initial reserve liquidity
const NULL_ADDRESS = address("11111111111111111111111111111111");
const SYSVAR_INSTRUCTIONS = address("Sysvar1nstructions1111111111111111111111111");

type DevnetState = {
  admin?: string;
  tslaxMint?: string;
  adminAta?: string;
  market?: string;
  reserve?: string;
  reserveKeypair?: number[];
  reserveConfigured?: boolean;
  ctokenMint?: string;
  seedDeposited?: boolean;
};

function loadState(): DevnetState {
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8")) as DevnetState;
  } catch {
    return {};
  }
}

function saveState(state: DevnetState): void {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(state, null, 2));
  console.log(`state saved -> ${OUTPUT_PATH}`);
}

async function sendIxs(
  rpc: ReturnType<typeof createSolanaRpc>,
  rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>,
  feePayer: TransactionSigner,
  ixs: Instruction[],
  label: string
): Promise<void> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  let message = createTransactionMessage({ version: 0 });
  message = setTransactionMessageFeePayerSigner(feePayer, message);
  message = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message);
  message = appendTransactionMessageInstructions(ixs, message);
  const signed = await signTransactionMessageWithSigners(message);
  // NB: this kit version's send-and-confirm factory returns void, so there is
  // no signature to record. It throws on simulation/confirm failure, and each
  // step is verified by re-reading on-chain state afterwards.
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, {
    commitment: "confirmed",
  });
  console.log(`${label} confirmed`);
}

async function main(): Promise<void> {
  const state = loadState();
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR, "utf8")) as number[]);
  const adminKp = Keypair.fromSecretKey(secret);
  const adminSigner = await createKeyPairSignerFromBytes(secret);
  const adminBase58 = adminKp.publicKey.toBase58();
  state.admin = adminBase58;
  saveState(state);

  const connection = new Connection(RPC_URL, "confirmed");
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(
    RPC_URL.replace("https://", "wss://").replace("http://", "ws://")
  );

  const sol = await connection.getBalance(adminKp.publicKey);
  console.log(`admin: ${adminBase58}  balance: ${sol / LAMPORTS_PER_SOL} SOL`);
  if (sol < 0.3 * LAMPORTS_PER_SOL) {
    throw new Error("Admin wallet needs devnet SOL first (faucet rate-limited, retry `solana airdrop`).");
  }

  // ---- 1. TSLAx mint ----
  if (!state.tslaxMint) {
    console.log("creating TSLAx mint...");
    const mint = await createMint(connection, adminKp, adminKp.publicKey, null, TSLAX_DECIMALS);
    state.tslaxMint = mint.toBase58();
    console.log(`TSLAx mint: ${state.tslaxMint}`);
    saveState(state);
  }
  const tslaxMint = new PublicKey(state.tslaxMint);

  if (!state.adminAta) {
    const ata = await getOrCreateAssociatedTokenAccount(connection, adminKp, tslaxMint, adminKp.publicKey);
    state.adminAta = ata.address.toBase58();
    const amount = BigInt(TSLAX_SUPPLY) * BigInt(10 ** TSLAX_DECIMALS);
    await mintTo(connection, adminKp, tslaxMint, ata.address, adminKp, amount);
    console.log(`minted ${TSLAX_SUPPLY} TSLAx to ${state.adminAta}`);
    saveState(state);
  }

  // ---- 2. Kamino market ----
  const kamino = new KaminoManager(rpc, DEFAULT_RECENT_SLOT_DURATION_MS, address(KLEND_PROGRAM_ID));
  if (!state.market) {
    console.log("creating Kamino lending market...");
    const { market, ixs } = await kamino.createMarketIxs({ admin: adminSigner });
    await sendIxs(rpc, rpcSubscriptions, adminSigner, ixs, "create-market");
    state.market = market.address;
    console.log(`market: ${state.market}`);
    saveState(state);
  }

  function buildTargetConfig() {
    const base = defaultReserveConfig();
    const tokenInfo = new TokenInfo({
      // @ts-expect-error spread of decoded class instance into fields
      ...base.tokenInfo,
      name: encodeTokenName("TSLAx"),
      maxTwapDivergenceBps: new BN(0),
      maxAgePriceSeconds: new BN(120),
      maxAgeTwapSeconds: new BN(240),
      pythConfiguration: new PythConfiguration({ price: address(adminBase58) }),
      scopeConfiguration: new ScopeConfiguration({
        priceFeed: NULL_ADDRESS,
        priceChain: [65535, 65535, 65535, 65535],
        twapChain: [65535, 65535, 65535, 65535],
      }),
      switchboardConfiguration: new SwitchboardConfiguration({
        priceAggregator: NULL_ADDRESS,
        twapAggregator: NULL_ADDRESS,
      }),
    });
    return new ReserveConfig({
      // @ts-expect-error spread of decoded class instance into fields
      ...base,
      status: 0, // Active
      loanToValuePct: 0,
      liquidationThresholdPct: 0,
      depositLimit: new BN("1000000000000000"), // 1e9 TSLAx in base units
      borrowLimit: new BN(0),
      borrowFactorPct: new BN(100), // minimum accepted by on-chain validation
      // 11-point curve mirroring Kamino's example: first point at 0
      // utilization, last at 10000 bps, ascending (enforced on-chain).
      borrowRateCurve: new BorrowRateCurve({
        points: [
          new CurvePoint({ utilizationRateBps: 0, borrowRateBps: 100 }),
          new CurvePoint({ utilizationRateBps: 7000, borrowRateBps: 400 }),
          new CurvePoint({ utilizationRateBps: 9100, borrowRateBps: 600 }),
          new CurvePoint({ utilizationRateBps: 9300, borrowRateBps: 1000 }),
          new CurvePoint({ utilizationRateBps: 9500, borrowRateBps: 2000 }),
          new CurvePoint({ utilizationRateBps: 9700, borrowRateBps: 4000 }),
          new CurvePoint({ utilizationRateBps: 10000, borrowRateBps: 8000 }),
          new CurvePoint({ utilizationRateBps: 10000, borrowRateBps: 8000 }),
          new CurvePoint({ utilizationRateBps: 10000, borrowRateBps: 8000 }),
          new CurvePoint({ utilizationRateBps: 10000, borrowRateBps: 8000 }),
          new CurvePoint({ utilizationRateBps: 10000, borrowRateBps: 8000 }),
        ],
      }),
      tokenInfo,
    });
  }

  function assetConfigFor(target: ReserveConfig) {
    return new AssetReserveConfigCli(
      address(state.tslaxMint!),
      address(TOKEN_PROGRAM_ID.toBase58()),
      target
    );
  }

  // ---- 3. TSLAx reserve account ----
  if (!state.reserve) {
    // Generate via web3.js so the secret stays available for this run only;
    // it is never written to state (block 3b only needs the address).
    const rk = Keypair.generate();
    const reserveKeypair = await createKeyPairSignerFromBytes(rk.secretKey);
    const { createReserveIxs } = await kamino.addAssetToMarketIxs({
      admin: adminSigner,
      adminLiquiditySource: address(state.adminAta!),
      marketAddress: address(state.market!),
      assetConfig: assetConfigFor(buildTargetConfig()),
      reserveKeypair,
    });

    if (createReserveIxs.length > 0) {
      await sendIxs(rpc, rpcSubscriptions, adminSigner, createReserveIxs, "init-reserve");
    } else {
      console.log("reserve account already exists, skipping creation");
    }
    state.reserve = reserveKeypair.address;
    delete (state as { reserveKeypair?: unknown }).reserveKeypair;
    saveState(state);
  }

  // ---- 3b. TSLAx reserve config (resumable: diffed against on-chain state) ----
  if (!state.reserveConfigured) {
    console.log("diffing reserve config against on-chain state...");
    const { configUpdateIxs } = await kamino.addAssetToMarketIxs({
      admin: adminSigner,
      adminLiquiditySource: address(state.adminAta!),
      marketAddress: address(state.market!),
      assetConfig: assetConfigFor(buildTargetConfig()),
      // Reserve already exists; only its address is used for the config diff.
      // A noop signer suffices because updates are authorized by the market admin.
      reserveKeypair: createNoopSigner(address(state.reserve!)),
    });

    const blocked = configUpdateIxs.filter((u) => u.requiresGlobalAdmin);
    if (blocked.length > 0) {
      throw new Error(
        `Reserve config needs ${blocked.length} global-admin update(s); supply-only config should not. Aborting.`
      );
    }
    console.log(`applying ${configUpdateIxs.length} reserve config update(s)...`);
    for (let i = 0; i < configUpdateIxs.length; i++) {
      await sendIxs(rpc, rpcSubscriptions, adminSigner, [configUpdateIxs[i].ix], `config-update ${i + 1}/${configUpdateIxs.length}`);
    }
    state.reserveConfigured = true;
    saveState(state);
    console.log(`reserve: ${state.reserve}`);
  }

  // ---- 4. Seed liquidity ----
  if (!state.seedDeposited) {
    const reserveAddr = address(state.reserve!);
    // biome-ignore lint: runtime shape differs between SDK versions
    const fetched = (await (Reserve as unknown as { fetch: Function }).fetch(rpc, reserveAddr, KLEND_PROGRAM_ID)) as any;
    const reserveState = fetched?.state ?? fetched;
    const supplyVault: string = String(reserveState.liquidity.supplyVault ?? reserveState.liquidity.supply_vault);
    const liqMint: string = String(reserveState.liquidity.mintPubkey ?? reserveState.liquidity.mint_pubkey);
    const ctokenMint: string = String(reserveState.collateral.mintPubkey ?? reserveState.collateral.mint_pubkey);
    state.ctokenMint = ctokenMint;
    console.log(`reserve supply vault: ${supplyVault}`);
    console.log(`cToken mint: ${ctokenMint}`);

    const ctokenAta = await getOrCreateAssociatedTokenAccount(
      connection, adminKp, new PublicKey(ctokenMint), adminKp.publicKey
    );
    const [marketAuth] = await lendingMarketAuthPda(address(state.market!), address(KLEND_PROGRAM_ID));
    const seedAmount = new BN(String(BigInt(SEED_DEPOSIT) * BigInt(10 ** TSLAX_DECIMALS)));
    const depositIx = depositReserveLiquidity(
      { liquidityAmount: seedAmount },
      {
        owner: adminSigner,
        reserve: reserveAddr,
        lendingMarket: address(state.market!),
        lendingMarketAuthority: marketAuth,
        reserveLiquidityMint: address(liqMint),
        reserveLiquiditySupply: address(supplyVault),
        reserveCollateralMint: address(ctokenMint),
        userSourceLiquidity: address(state.adminAta!),
        userDestinationCollateral: address(ctokenAta.address.toBase58()),
        collateralTokenProgram: address(TOKEN_PROGRAM_ID.toBase58()),
        liquidityTokenProgram: address(TOKEN_PROGRAM_ID.toBase58()),
        instructionSysvarAccount: SYSVAR_INSTRUCTIONS,
      }
    );
    await sendIxs(rpc, rpcSubscriptions, adminSigner, [depositIx], "seed-deposit");
    state.seedDeposited = true;
    saveState(state);
  }

  console.log("\nDone. Devnet environment ready:");
  console.log(JSON.stringify(state, null, 2));
  console.log("\nRoot .env additions:");
  console.log(`TSLAX_MINT=${state.tslaxMint}`);
  console.log(`KAMINO_MARKET=${state.market}`);
  console.log(`KAMINO_RESERVE=${state.reserve}`);
  console.log(`KAMINO_CTOKEN_MINT=${state.ctokenMint}`);
}

main().catch((err) => {
  console.error("setup_devnet failed:", err);
  process.exit(1);
});
