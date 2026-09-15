export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

export const TSLAX_MINT = process.env.NEXT_PUBLIC_TSLAX_MINT ?? "";
export const KAMINO_MARKET = process.env.NEXT_PUBLIC_KAMINO_MARKET ?? "";
export const KAMINO_RESERVE = process.env.NEXT_PUBLIC_KAMINO_RESERVE ?? "";
export const KAMINO_CTOKEN_MINT = process.env.NEXT_PUBLIC_KAMINO_CTOKEN_MINT ?? "";
export const KAMINO_SUPPLY_VAULT = process.env.NEXT_PUBLIC_KAMINO_SUPPLY_VAULT ?? "";
export const VAULT_PROGRAM_ID = process.env.NEXT_PUBLIC_VAULT_PROGRAM_ID ?? "";

export const KLEND_PROGRAM_ID = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
export const TSLAX_DECIMALS = 6;

export function isConfigured(): boolean {
  return Boolean(TSLAX_MINT && KAMINO_RESERVE && VAULT_PROGRAM_ID);
}
