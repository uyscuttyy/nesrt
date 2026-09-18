import { Connection, PublicKey } from "@solana/web3.js";
import { MOCK_LENDER_POOL, SOLANA_RPC_URL } from "./config";

export type PoolSnapshot = {
  /** TSLAx per nTSLA share. Starts at 1.0, grows with yield. */
  rate: number;
  totalDepositsBase: bigint;
  totalSharesBase: bigint;
  yieldAccruedBase: bigint;
  /** Yield as % of deposits (simple, since mock drips instantly). */
  apyPct: number;
};

export type ReserveSnapshot = {
  rate: number;
  totalAvailableBase: bigint;
  ctokenSupplyBase: bigint;
};

/** mock_lender Pool layout: 8 disc + 32*4 + 8*3 + 1 bump = 161 bytes. */
function parsePool(data: Buffer): { totalDeposits: bigint; totalShares: bigint; yieldAccrued: bigint } {
  // skip 8 disc + 32*4 (authority, tslax_mint, vault, shares_mint)
  let o = 8 + 32 * 4;
  const totalDeposits = data.readBigUInt64LE(o); o += 8;
  const totalShares = data.readBigUInt64LE(o); o += 8;
  const yieldAccrued = data.readBigUInt64LE(o);
  return { totalDeposits, totalShares, yieldAccrued };
}

export async function fetchPoolSnapshot(
  connection?: Connection,
  poolAddr?: string
): Promise<PoolSnapshot> {
  const conn = connection ?? new Connection(SOLANA_RPC_URL, "confirmed");
  const pool = new PublicKey(poolAddr ?? MOCK_LENDER_POOL);
  const info = await conn.getAccountInfo(pool);
  if (!info) throw new Error("Mock lender pool not found. Run scripts/init-mock-lender-pool.ts.");
  const { totalDeposits, totalShares, yieldAccrued } = parsePool(info.data as Buffer);
  const totalValue = totalDeposits + yieldAccrued;
  const rate = totalShares === 0n ? 1 : Number(totalValue) / Number(totalShares);
  const apyPct = totalDeposits === 0n ? 0 : (Number(yieldAccrued) / Number(totalDeposits)) * 100;
  return { rate, totalDepositsBase: totalDeposits, totalSharesBase: totalShares, yieldAccruedBase: yieldAccrued, apyPct };
}

/** Back-compat alias used by dashboard: live rate from mock pool. */
export async function fetchReserveSnapshot(): Promise<ReserveSnapshot> {
  const s = await fetchPoolSnapshot();
  return {
    rate: s.rate,
    totalAvailableBase: s.totalDepositsBase + s.yieldAccruedBase,
    ctokenSupplyBase: s.totalSharesBase,
  };
}
