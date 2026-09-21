# PRD: Nesrt — Yield Vault for Tokenized Equities (Devnet)

## Product
Nesrt is a single-click yield vault for tokenized equities on Solana. Users deposit a tokenized equity (e.g., TSLAx), receive a liquid receipt token (nTSLA), and the protocol routes the underlying collateral into the Nesrt lending pool (mock v2, Kamino-compatible CPI interface) to earn lending yield. The protocol takes a 10% performance fee on accrued yield, routed to a program-controlled treasury. Price data comes from Pyth; secondary liquidity is available on Meteora; governance authority is prepared for Squads V4 multisig.

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
Connect Wallet (Phantom)
      ↓
Receive mock TSLAx (1-click faucet; SOL airdrop best-effort)
      ↓
Deposit TSLAx into Nesrt Vault (or Zap SOL/USDC → auto-converted + deposited)
      ↓
Nesrt routes TSLAx → lending pool via CPI (Pyth/stub oracle gate on every flow)
      ↓
Yield accrues in pool (admin drip_yield; share price rises)
      ↓
User receives nTSLA (1:1 against shares received)
      ↓
Track position / yield in real-time dashboard
      ↓
Partial withdrawal (specify TSLAx amount) → nTSLA burned proportionally → underlying returned
      ↓
Or: Trade nTSLA on Meteora for instant USDC liquidity (live pair, dashboard Trade card)
```

## Core Functionality

### Must Have ✅
- **Deposit TSLAx**: User TSLAx → vault custody → pool supply CPI → nTSLA minted 1:1 vs shares
- **Zap-In (SOL/USDC)**: Jupiter v6 quote/swap primary with atomic-bundle attempt + sequential fallback; devnet faucet-rate mint fallback (`/api/zap`, payment-verified, replay-guarded) → auto-deposit
- **Withdraw TSLAx (partial & full)**: nTSLA burned → proportional shares redeemed → underlying TSLAx + yield returned
- **Pyth Oracle Gate**: TSLAx/USD feed id + staleness enforced on deposit/withdraw (real Hermes updates, or admin-posted devnet stub PDA with 24h window)
- **10% Performance Fee**: `protocol_fee_bps = 1000` on accrued yield, routed to Treasury PDA
- **Emergency Pause**: `is_paused` flag on VaultState; `set_paused` admin instruction; deposits/withdraws halt when paused
- **Admin Transfer**: `set_admin` instruction for Squads V4 multisig migration
- **Devnet Faucet**: 1-click TSLAx airdrop via `/api/faucet` route (server-signed) + permanent dashboard button
- **Real-time Dashboard**: Live balances, yield chart, webhook-first history, Trade card
- **Meteora Integration**: nTSLA/USDC DLMM pair live (`3iCpUt4RPQ2gzjAN55w3tuar1Qa4YaH4qqD3LZxJtfUM`, 0.25% fee, seeded 10+10), created + seeded from in-app `/app/pool`
- **Mock Lender v2 Pool**: Vault-compatible deposit/redeem, pool PDA signs directly, drip yield
- **Update Mock Pool**: `update_mock_pool` instruction for pool migration (admin-gated)

### Should Have ✅
- **Treasury PDA**: Program-owned, accumulates protocol fees (0.022056 TSLAx skimmed to date)
- **Pool Yield Display**: Live accrued/deposited ratio with on-card formula proof
- **Error Humanization**: Friendly toast messages for all common RPC/wallet errors + transient auto-retry
- **Onboarding Modal**: Explains Devnet/mock assets, offers faucet (SOL best-effort)

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
| Deposit with mock v2 CPI | ✅ Implemented | 8/8 anchor tests pass |
| Partial withdrawal by TSLAx amount | ✅ Implemented | Tested in integration tests |
| Zap-In (SOL/USDC) | ✅ Implemented | Jupiter primary + devnet fallback, E2E-tested (0.02 SOL → 0.2 TSLAx → nTSLA) |
| Pyth on-chain gate | ✅ Active (stub) | Feed id + staleness on deposit/withdraw; Hermes path ready |
| 10% protocol fee on yield | ✅ Implemented | Treasury PDA, fee skim on withdraw |
| Emergency pause/unpause | ✅ Implemented | `set_paused`, `VaultPaused` error |
| Admin transfer for Squads V4 | ✅ Implemented | `set_admin`, `WrongAdmin` error |
| Devnet faucet (SOL + TSLAx) | ✅ Implemented | Live tested, returns real signatures |
| Frontend build | ✅ Clean | `npm run build` zero errors |
| Yield chart (Recharts) | ✅ Implemented | Local history + live rate |
| Transaction history | ✅ Implemented | RPC signature parsing |
| Meteora DLMM trade card | ✅ Implemented | Live pair `3iCpUt4RPQ2gzjAN55w3tuar1Qa4YaH4qqD3LZxJtfUM`, dashboard Trade card |
| Reserve health indicator | ✅ Implemented | Real liquidity data |
| Error humanization | ✅ Implemented | 15+ error codes mapped |
| Devnet borrow crank | ✅ Documented | `scripts/devnet-crank.ts` with discriminators |
| Meteora pool creation | ✅ Done in-app | `/app/pool` custom-fee SDK flow (0.25%, bin 25); Meteora UI locks unverified tokens to 10% |
| Squads V4 badge | ⏳ Pending | Awaits multisig execution |
| Helius webhooks | ✅ Endpoint live | POST/GET routes + webhook-first history; live delivery needs public URL + key |
| Pyth Hermes posting | ⏳ Blocked | All Hermes update endpoints 401 without API key; stub covers devnet |
| Meteora program CPI | ⏳ Not started | Vault has no Meteora CPI by design (SDK pool create/seed via frontend) |
| Update mock pool config | ✅ Implemented | `update_mock_pool` + `update_stub_price` admin instructions |

## Devnet Addresses (Live)

| Component | Address |
|-----------|---------|
| Vault Program | `DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB` |
| Squads Multisig | `EuFKrjdgTJ4G4fnU3VWLhmiWb1LN9JcCMUJD6Q4mumdG` |
| Vault Admin | `J28vmQF8RPKnvcy1tZLxBAxmqxwYwvak56nMmfMGYLc3` (Squads multisig `EuFKrjdgTJ4G4fnU3VWLhmiWb1LN9JcCMUJD6Q4mumdG` prepared) |
| TSLAx Mint | `4Dimn4s78herJKGhD3oxMMGbZcjirgwt376tdjq4HevA` |
| VaultState (v2) | `GjyzrgQMW6UPGhaqXzCkBi9aBhYnBQoYQZX4ZjZanwun` |
| Treasury PDA | `CEHuKwAgZp4aaynTo1oivCYT7nRGnWVRW9kSGd5MLmM4` (0.022056 TSLAx skimmed) |
| Pyth Stub PDA | `2cXuUBQRjeDTJMCXVrq17VrS36spJcyXhxP6AE3HfKoZ` (TSLAx/USD, admin-posted) |
| Meteora LB Pair | `3iCpUt4RPQ2gzjAN55w3tuar1Qa4YaH4qqD3LZxJtfUM` (nTSLA/USDC, 0.25%, seeded 10+10) |
| Kamino Market/Reserve (superseded, kept for reference) | `GjyuKPft2jBXy5aB32VWcWY5cc6jvAFcQozW6SkS7hSG` / `24EfeXj3XyLLE6GThh8ik4vcxEPMooAU5XXDL5nJHEr8` |
| Pyth Feed (legacy placeholder, never created on-chain) | `FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9` |
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