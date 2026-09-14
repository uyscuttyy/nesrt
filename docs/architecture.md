# Architecture: TSLAx Yield Vault

## On-chain (`programs/vault/`)
- `VaultState` PDA, seeds `[b"vault", tslax_mint]`: admin, tslax_mint,
  receipt_mint, kamino_market, kamino_reserve, kamino_ctoken_mint,
  authority_bump, state_bump.
- Vault authority PDA, seeds `[b"vault-authority", tslax_mint]`: owns the
  vault TSLAx + cToken custody accounts, is yTSLAx mint authority, and signs
  the Kamino CPI via `authority_seeds()`.
- PDAs: receipt mint `[b"receipt-mint", tslax_mint]` (6 decimals),
  TSLAx custody `[b"vault-tslax", tslax_mint]`, cToken custody
  `[b"vault-ctoken", tslax_mint]`.
- `initialize_vault` (Phase 3), `deposit` + Kamino supply CPI (Phase 4),
  `withdraw` + Kamino redeem CPI (Phase 5).
- Accounting: yTSLAx minted 1:1 against cTokens received on deposit, burned
  on withdraw; redeem converts the same cTokens back to TSLAx plus interest.
- Kamino CPI built manually (no klend crate): program
  KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD, deposit discriminator
  a9c91e7e06cd6644 + u64 amount, redeem discriminator
  ea75b57db98edc1d + u64 collateral amount.

## Setup (`setup/setup_devnet.ts`, Phase 2)
Creates TSLAx mint, mints admin supply, creates Kamino market + TSLAx
reserve, seeds liquidity. Outputs addresses to `.env`.

## Frontend (`app/`, Phases 7-9)
- `/` landing: "Wake up your sleeping capital." CTA to `/app`.
- `/app` dashboard (The Sanctuary): wallet connect, TSLAx balance,
  deposit input, withdraw, live balance = yTSLAx balance x Kamino
  cToken exchange rate (never faked).
- Read path: `KaminoMarket.load` fails on oracle-less reserves, so the
  frontend decodes the reserve account directly (codegen `Reserve.fetch`)
  and computes rate = totalAvailableAmount / cToken supply.

## Wallet environment note
Phone testing happens inside the Nimiq Pay mini-app browser. Whether that
webview injects a Solana provider (`window.solana`) is unconfirmed. The
dashboard will detect providers at runtime; if no Solana provider exists,
an explicit execution path (e.g. backend relayer or deep-link to a Solana
wallet) must be chosen before demo. No external redirects by default.
