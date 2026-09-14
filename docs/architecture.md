# Architecture: TSLAx Yield Vault

## On-chain (`programs/vault/`)
- `VaultState` PDA, seeds `[b"vault", tslax_mint]`: admin, tslax_mint,
  receipt_mint, kamino_market, kamino_reserve, bump.
- Receipt mint `yTSLAx`: vault program is mint authority, minted 1:1 on
  deposit, burned on withdraw (accounting only, hidden in UI).
- `initialize_vault` (Phase 3), `deposit` + Kamino supply CPI (Phase 4),
  `withdraw` + Kamino redeem CPI (Phase 5).

## Setup (`setup/setup_devnet.ts`, Phase 2)
Creates TSLAx mint, mints admin supply, creates Kamino market + TSLAx
reserve, seeds liquidity. Outputs addresses to `.env`.

## Frontend (`app/`, Phases 7-9)
- `/` landing: "Wake up your sleeping capital." CTA to `/app`.
- `/app` dashboard (The Sanctuary): wallet connect, TSLAx balance,
  deposit input, withdraw, live balance = yTSLAx balance x Kamino
  cToken exchange rate (never faked).

## Wallet environment note
Phone testing happens inside the Nimiq Pay mini-app browser. Whether that
webview injects a Solana provider (`window.solana`) is unconfirmed. The
dashboard will detect providers at runtime; if no Solana provider exists,
an explicit execution path (e.g. backend relayer or deep-link to a Solana
wallet) must be chosen before demo. No external redirects by default.
