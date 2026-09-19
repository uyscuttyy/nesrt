export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

export const TSLAX_MINT = process.env.NEXT_PUBLIC_TSLAX_MINT ?? "";
export const VAULT_PROGRAM_ID = process.env.NEXT_PUBLIC_VAULT_PROGRAM_ID ?? "";

// Mock lender (replaces legacy Kamino bindings). Env-overridable, sane devnet defaults.
export const MOCK_LENDER_PROGRAM_ID =
  process.env.NEXT_PUBLIC_MOCK_LENDER_PROGRAM_ID ??
  "7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g";
export const MOCK_LENDER_POOL =
  process.env.NEXT_PUBLIC_MOCK_LENDER_POOL ??
  "6TdFhCAHbod21bm7BCenz3fEAgfTQr1BGri7Mzjie9Nx";
export const MOCK_LENDER_SHARES_MINT =
  process.env.NEXT_PUBLIC_MOCK_LENDER_SHARES_MINT ??
  "6s2qM9MbCgcZzfdEmYt9PnvoYLpuF91PGCZ3T5noquAg";
export const PYTH_PRICE_FEED =
  process.env.NEXT_PUBLIC_PYTH_PRICE_FEED ??
  "FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9";

// Hermes-posted TSLAx/USD PriceUpdateV2 account (pull model: fresh per tx).
// Empty until Hermes posting is set up — builders throw a clear error then.
export const PYTH_PRICE_UPDATE = process.env.NEXT_PUBLIC_PYTH_PRICE_UPDATE ?? "";

export const TSLAX_DECIMALS = 6;

// Meteora DLMM nTSLA/USDC pair (devnet). Set after pool creation + seeding.
export const LB_PAIR_ADDRESS =
  process.env.NEXT_PUBLIC_LB_PAIR ??
  "3iCpUt4RPQ2gzjAN55w3tuar1Qa4YaH4qqD3LZxJtfUM";

export function isConfigured(): boolean {
  return Boolean(TSLAX_MINT && VAULT_PROGRAM_ID && MOCK_LENDER_POOL);
}
