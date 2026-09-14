# PRD: TSLAx Yield Vault (Devnet MVP)

## Problem
Tokenized equities (TSLAx) sit idle in wallets. Holders want lending yield
without managing DeFi positions (rate comparison, Kamino usage, LTVs).

## Solution
One-click, single-asset vault. User deposits TSLAx. The program custodies it
in a vault PDA and routes it into a Kamino Lend reserve via CPI. The user
watches their balance grow and withdraws principal plus interest at any time.

## Scope (locked)
- Asset: mock TSLAx SPL token.
- Protocol: Kamino Lend, Devnet only.
- Network: Solana Devnet.
- Functions: deposit TSLAx, accrue real Kamino Devnet yield, withdraw TSLAx.

## Non-goals
- Mainnet, real equities, leverage, multi-asset, governance, fees.
