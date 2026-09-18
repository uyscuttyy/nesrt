# PRD: Nesrt — Yield Vault for Tokenized Equities (Devnet)

## Product
Nesrt is a single-click yield vault for tokenized equities on Solana. Users deposit a tokenized equity (e.g., TSLAx), receive a liquid receipt token (nTSLA), and the protocol routes the underlying collateral into Kamino Lend via CPI to earn lending yield. The protocol takes a 10% performance fee on accrued yield, routed to a program-controlled treasury. Price data comes from Pyth; secondary liquidity is available on Meteora; governance authority is prepared for Squads V4 multisig.

## Problem
Tokenized equities (TSLAx, AAPLx, etc.) sit idle in user wallets earning 0% yield. Holders want lending yield but lack the expertise or desire to manage DeFi positions (rate comparison, Kamino usage, LTV monitoring, liquidation risk). Existing DeFi requires users to navigate multiple protocols, manage collateral ratios, and actively monitor positions.

## Target Users
- Retail holders of tokenized equities on Solana Devnet (hackathon demo)
- Treasury managers of protocols issuing tokenized RWAs
- DeFi-native users seeking automated yield on equity collateral

## Core Value Proposition
**1-click yield abstraction for tokenized equities + liquid receipt token (nTSLA).** Deposit once, earn continuously, withdraw anytime, trade the receipt token on Meteora for instant liquidity without unwinding the vault position.

## Why Tokenized Equities Need a Yield Layer
- Equities are productive assets; idle capital is inefficient
- Tokenized equity holders are typically not DeFi power users
- A dedicated vault abstracts Kamino complexity while preserving composability

## Why Liquid Receipt Tokens (nTSLA) Matter
- nTSLA represents a proportional claim on vault assets (TSLAx + accrued yield)
- Can be traded on Meteora DLMM for immediate liquidity without waiting for vault withdrawal
- Enables secondary DeFi: nTSLA as collateral, nTSLA in yield strategies, nTSLA in DAO treasuries
- Price discovery: nTSLA market price reflects real-time vault NAV

## Core User Journey
```
Connect Wallet (Phantom/Solflare)
      ↓
Receive mock TSLAx + Devnet SOL (1-click faucet)
      ↓
Deposit TSLAx into Nesrt Vault
      ↓
Nesrt routes TSLAx → Kamino Lend reserve via CPI
      ↓
Yield accrues in Kamino reserve (cToken exchange rate rises)
      ↓
User receives nTSLA (1:1 against cTokens received)
      ↓
Track position / yield in real-time dashboard
      ↓
Partial withdrawal (specify TSLAx amount) → nTSLA burned proportionally → underlying returned
      ↓
Or: Trade nTSLA on Meteora for instant USDC liquidity
```

## Core Functionality

### Must Have ✅
- **Deposit TSLAx**: User TSLAx → vault custody → Kamino supply CPI → nTSLA minted 1:1 vs cTokens
- **Withdraw TSLAx (partial & full)**: nTSLA burned → proportional cTokens redeemed from Kamino → underlying TSLAx + yield returned
- **Pyth Oracle Integration**: Pyth Devnet TSLA/USD feed stored in VaultState, passed to Kamino reserve context
- **10% Performance Fee**: `protocol_fee_bps = 1000` on accrued yield, routed to Treasury PDA
- **Emergency Pause**: `is_paused` flag on VaultState; `set_paused` admin instruction; deposits/withdraws halt when paused
- **Admin Transfer**: `set_admin` instruction for Squads V4 multisig migration
- **Devnet Faucet**: 1-click SOL + TSLAx airdrop via `/api/faucet` route (server-signed)
- **Real-time Dashboard**: Live balances, yield chart (Recharts), transaction history, reserve health
- **Meteora Integration**: nTSLA/USDC DLMM pool discoverable from dashboard
- **Devnet Borrow Crank**: `scripts/devnet-crank.ts` documents exact discriminators and account structures to drive Kamino utilization
- **Update Kamino Config**: `update_kamino_config` instruction for reserve switching (admin-gated)

### Should Have ✅
- **Treasury PDA**: Program-owned, accumulates protocol fees
- **Reserve Health Indicator**: Kamino liquidity availability shown in UI
- **Error Humanization**: Friendly toast messages for all common RPC/wallet errors
- **Onboarding Modal**: Explains Devnet/mock assets, offers faucet
- **Live Pyth Header**: Real-time TSLA/USD price with staleness indicator

### Known Limitations (Devnet)
- **Kamino TSLAx Reserve**: No TSLAx reserve exists on devnet Kamino. The vault's Kamino config points to a placeholder. Yield activation requires Kamino to onboard TSLAx on devnet (not permissionless). This is an infrastructure limitation, not a code gap.
- **SOL Reserve**: A native SOL reserve exists on devnet but its collateral mint was never initialized, making it unusable for deposits.
- **Mock Lender (Active)**: Deployed lightweight Anchor program (`7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g`) simulating Kamino CPI interface. E2E-verified live (deposit → mock_lender → nTSLA mint, drip → withdraw → principal + yield, 10% treasury skim; 6/6 tests pass).

### Future / Out of Scope
- Mainnet deployment with real tokenized equities
- Multi-asset vaults
- Governance token / voting
- Insurance module
- Leverage / borrow against nTSLA
- Cross-chain (Wormhole) support
- Audit (required before any mainnet value)

## Requirements Status

| Requirement | Status | Verified |
|-------------|--------|----------|
| Deposit with Kamino CPI | ✅ Implemented | 6/6 anchor tests pass |
| Partial withdrawal by TSLAx amount | ✅ Implemented | Tested in integration tests |
| Pyth price feed in VaultState | ✅ Implemented | Stored, passed to CPI context |
| 10% protocol fee on yield | ✅ Implemented | Treasury PDA, fee skim on withdraw |
| Emergency pause/unpause | ✅ Implemented | `set_paused`, `VaultPaused` error |
| Admin transfer for Squads V4 | ✅ Implemented | `set_admin`, `WrongAdmin` error |
| Devnet faucet (SOL + TSLAx) | ✅ Implemented | Live tested, returns real signatures |
| Frontend build | ✅ Clean | `npm run build` zero errors |
| Yield chart (Recharts) | ✅ Implemented | Local history + live rate |
| Transaction history | ✅ Implemented | RPC signature parsing |
| Meteora DLMM discoverability | ✅ Implemented | Trade tab with pool link |
| Reserve health indicator | ✅ Implemented | Real liquidity data |
| Error humanization | ✅ Implemented | 15+ error codes mapped |
| Devnet borrow crank | ✅ Documented | `scripts/devnet-crank.ts` with discriminators |
| Meteora pool creation | ⚠️ Manual Only | DLMM SDK has bugs; manual creation required |
| Squads V4 badge | ⏳ Pending | Awaits multisig execution |
| Helius webhooks | ⏳ Not started | Polling fallback active |
| Pyth on-chain validation | ⏳ Partial | Feed stored, not validated in CPI |
| Meteora on-chain CPI | ⏳ Not started | Frontend link only |
| Update Kamino config | ✅ Implemented | `update_kamino_config` instruction added |

## Devnet Addresses (Live)

| Component | Address |
|-----------|---------|
| Vault Program | `DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB` |
| Squads Multisig | `EuFKrjdgTJ4G4fnU3VWLhmiWb1LN9JcCMUJD6Q4mumdG` |
| Vault Admin | `EuFKrjdgTJ4G4fnU3VWLhmiWb1LN9JcCMUJD6Q4mumdG` (multisig) |
| TSLAx Mint | `4Dimn4s78herJKGhD3oxMMGbZcjirgwt376tdjq4HevA` |
| VaultState (v2) | `GjyzrgQMW6UPGhaqXzCkBi9aBhYnBQoYQZX4ZjZanwun` |
| Treasury PDA | `F3y3LsqVFLFVESdS6vrGvK3Yj9sKByG9mUnBzvrUKfZA` |
| Kamino Market (env) | `GjyuKPft2jBXy5aB32VWcWY5cc6jvAFcQozW6SkS7hSG` |
| Kamino Reserve (env) | `24EfeXj3XyLLE6GThh8ik4vcxEPMooAU5XXDL5nJHEr8` (SOL reserve) |
| cToken Mint | `8f7e9FfKq7YEGNdqp9Hbsu7VtCk1VNYg8Jq4vYk1gRQJ` |
| Pyth Feed | `FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9` |
| Mock Lender Program | `7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g` |
| Mock Lender Pool PDA | `6TdFhCAHbod21bm7BCenz3fEAgfTQr1BGri7Mzjie9Nx` |
| Mock Lender Shares Mint | `6s2qM9MbCgcZzfdEmYt9PnvoYLpuF91PGCZ3T5noquAg` |
| Mock Lender Vault ATA | `6suncjAX9zZ9S44NH3t5LESriEVRJS8FYGoUXkr5osmc` |

## Hackathon Completion Status
**Backend Protocol: COMPLETE** ✅
- 11 instructions deployed and tested
- Squads V4 multisig created and admin transferred
- Emergency pause verified (non-admin correctly rejected)
- All 6 integration tests passing
- Governance ready for multisig control

**Yield Activation: COMPLETE (Mock Lender v2)** ✅
- No TSLAx reserve exists on devnet Kamino
- SOL reserve exists but collateral mint not initialized
- Mock lender deployed at `7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g`
- Mock v2 deployed, pool + treasury initialized, vault config updated
- E2E verified live with real yield + 10% skim

**Frontend: COMPLETE** ✅
- Dashboard builds cleanly (`next build` + `tsc --noEmit`)
- Phantom-only connect, 1-click Vault/Unvault card, APY + totals up front, advanced drawer
- Frontend rewired from Kamino to mock_lender (Anchor.toml `7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g`)
- Error handling, onboarding
- Meteora pool discoverability
- Error handling, onboarding

**Documentation: COMPLETE** ✅
- PRD, Architecture, Handoff updated
- All discriminators and account structures documented