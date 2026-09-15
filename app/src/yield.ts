import { address, createSolanaRpc } from "@solana/kit";
import { Reserve } from "@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/Reserve.js";
import { KAMINO_RESERVE, SOLANA_RPC_URL } from "./config";

export type ReserveSnapshot = {
  /** cToken exchange rate: TSLAx per yTSLAx (unitless, real on-chain ratio). */
  rate: number;
  totalAvailableBase: bigint;
  ctokenSupplyBase: bigint;
};

/**
 * Reads the live Kamino reserve account directly (KaminoMarket.load needs an
 * oracle price, which a mock-asset reserve does not have) and returns the
 * real cToken exchange rate.
 */
export async function fetchReserveSnapshot(): Promise<ReserveSnapshot> {
  const rpc = createSolanaRpc(SOLANA_RPC_URL);
  // The SDK's generated types pin an older kit Rpc surface; the wire format
  // is identical, so cross the boundary with a cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reserve = await Reserve.fetch(rpc as any, address(KAMINO_RESERVE));
  if (!reserve) throw new Error("Kamino reserve account not found.");
  const totalAvailableBase = BigInt(reserve.liquidity.totalAvailableAmount.toString());
  const ctokenSupplyBase = BigInt(reserve.collateral.mintTotalSupply.toString());
  if (ctokenSupplyBase === 0n) throw new Error("Reserve has no cToken supply yet.");
  const rate = Number(totalAvailableBase) / Number(ctokenSupplyBase);
  return { rate, totalAvailableBase, ctokenSupplyBase };
}
