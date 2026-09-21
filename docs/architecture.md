# Architecture: Nesrt Yield Vault (Devnet)

## Repository Structure
```
nesrt/
├── programs/
│   └── vault/                 # Anchor program (Rust)
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs         # All instructions + state
├── programs/
│   └── mock_lender/           # Mock lender v2 (Rust)
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs         # initialize_pool, deposit, redeem, drip_yield
├── app/                       # Next.js 14 frontend
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.mjs
│   ├── .env.example
│   ├── .env.local             # gitignored, real keys
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx       # Landing page
│       │   ├── app/page.tsx   # Dashboard (Sanctuary)
│       │   ├── api/faucet/route.ts  # Server faucet
│       │   ├── globals.css
│       │   └── providers.tsx
│       ├── components/
│       │   ├── ThemeProvider.tsx
│       │   ├── ThemeToggle.tsx
│       │   ├── YieldChart.tsx      # Recharts
│       │   ├── Toasts.tsx          # Error toast stack
│       │   └── OnboardingModal.tsx
│       ├── lib/
│       │   ├── vault.ts            # Anchor tx builders
│       │   ├── yield.ts            # Mock pool snapshot (rate, yield)
│       │   ├── history.ts          # RPC signature parsing
│       │   ├── errors.ts           # Error humanization
│       │   └── config.ts           # Env config
│       └── idl/vault.json          # Hand-maintained IDL
├── scripts/
│   ├── migrate_state.cjs
│   ├── close_vault_v2.cjs
│   ├── init_state_v2.cjs
│   ├── verify_phase3.cjs
│   ├── verify_pause_guard.cjs
│   ├── test_init_custody.cjs
│   ├── devnet-crank.ts           # Borrow crank with discriminators
│   └── init-mock-lender-pool.ts  # Mock lender pool init
├── tests/
│   └── vault.ts                # Anchor integration tests (6/6 pass)
├── docs/
│   ├── prd.md
│   ├── architecture.md
│   └── handoff.md
├── setup/
│   ├── setup_devnet.ts         # Creates mint, market, reserve
│   ├── package.json
│   └── output/
├── keypairs/                   # gitignored
│   ├── nesrt-admin.json
│   └── vault-deploy.json
├── Anchor.toml
├── Cargo.toml                  # Workspace
├── package.json                # Root (scripts only)
├── tsconfig.json
├── README.md
└── target/                     # Build artifacts (gitignored)
    ├── idl/vault.json
    ├── types/vault.ts
    └── deploy/vault.so
```

## On-Chain Architecture (`programs/vault/src/lib.rs`)

### Program ID
`DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB` (Devnet, upgradeable)

### State Accounts

#### VaultState (PDA: `["vault-v2", tslax_mint]`)
```rust
pub struct VaultState {
    pub admin: Pubkey,                    // Authority for pause, admin transfer
    pub tslax_mint: Pubkey,               // Mock TSLAx SPL mint
    pub receipt_mint: Pubkey,             // nTSLA mint (vault-v2-authority is mint authority)
    pub mock_lender_pool: Pubkey,         // Mock v2 pool PDA
    pub mock_lender_shares_mint: Pubkey,  // Shares mint (yield position)
    pub pyth_price_feed: Pubkey,          // Legacy placeholder (stub PDA is live path)
    pub authority_bump: u8,               // Vault authority PDA bump
    pub state_bump: u8,                   // VaultState PDA bump
    pub is_paused: bool,                  // Emergency circuit breaker
    pub protocol_fee_bps: u16,            // 1000 = 10%
    pub total_deposits: u64,              // Principal accounting (base units)
    pub total_shares: u64,                // Outstanding nTSLA (base units)
    pub total_yield_skimmed: u64,         // Lifetime treasury fees
    pub kamino_market: Pubkey,            // Legacy (superseded)
    pub kamino_reserve: Pubkey,           // Legacy (superseded)
    pub kamino_ctoken_mint: Pubkey,       // Legacy (superseded)
}
```
**SPACE**: 325 bytes (8 disc + 32×9 + 1 + 1 + 1 + 2 + 8×3)

#### Vault Authority PDA (`["vault-v2-authority", tslax_mint]`)
- PDA signer: owns vault custody ATAs, nTSLA mint authority, treasury + stub token authority
- Signs mock CPI + mint/transfer CPIs via `invoke_signed` with seeds `["vault-v2-authority", tslax_mint, bump]`

#### Receipt Mint PDA (`["receipt", tslax_mint]`)
- 6 decimals, mint authority = vault-v2-authority
- nTSLA minted 1:1 against pool shares received on deposit (`init_if_needed` user ATA)
- Burned proportionally on withdrawal

#### Treasury PDA (`["treasury", tslax_mint]`)
- Program-owned token account for TSLAx
- Accumulates 10% of yield on each withdrawal
- Authority = vault-v2-authority (program-controlled)

#### Custody Token Accounts (ATAs owned by the vault authority PDA)
- **Vault TSLAx**: Holds deposited TSLAx before pool supply
- **Vault shares**: Holds mock pool shares (the yield position)
- **Pool vault**: Mock pool's TSLAx vault (holds all supplied liquidity + dripped yield)
- **Treasury PDA** (`["vault-treasury", tslax_mint]`): Program-owned token account, 10% fee sink
- **Stub oracle PDA** (`["pyth-stub", tslax_mint]`): Admin-posted TSLAx/USD price (61 bytes)

### Instructions

| Instruction | Purpose | Key Constraints |
|-------------|---------|-----------------|
| `initialize_state` | State init (pool + shares + pyth) | Admin only |
| `deposit(amount)` | User TSLAx → pool → nTSLA (+ Pyth/stub gate) | Pause guard, pool verify, mints 1:1, `init_if_needed` receipt |
| `withdraw(shares)` | nTSLA → pool redeem → TSLAx + fee skim (+ Pyth/stub gate) | Pause guard, share validation, pays user |
| `set_paused(paused)` | Emergency pause toggle | Admin only, `WrongAdmin` check |
| `set_admin(new_admin)` | Transfer authority to Squads | Admin only |
| `init_treasury` | Creates treasury token PDA | Admin (payer) |
| `update_mock_pool` | Update pool/shares addrs | Admin only |
| `update_stub_price` | Post devnet oracle price | Admin only, `WrongAdmin` check |
| `update_kamino_config` | Legacy config swap | Admin only (superseded) |
| `migrate_state` / `close_vault_state_v2` | Close old PDAs | Admin only |
| `crank_yield` | Drip via mock (fixed discriminator) | Admin/signer flow |

### Mock Lender v2 CPI Integration
- **Program**: `7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g` (admin upgrade authority; v1 superseded)
- **Deposit discriminator**: `[169, 201, 30, 126, 6, 205, 102, 68]` (`deposit_reserve_liquidity`)
- **Redeem discriminator**: `[234, 117, 181, 125, 185, 142, 220, 29]` (`redeem_reserve_collateral`)
- **Drip discriminator**: `[239, 228, 57, 16, 123, 244, 173, 146]` (`drip_yield`)
- **Account order** (vault-scoped, pool PDA signs directly, no alias account):
  1. Owner = vault authority (signer via `invoke_signed`, writable)
  2. Liquidity mint (readonly)
  3. Pool state (writable)
  4. Source custody — vault TSLAx on deposit / vault shares on redeem (writable)
  5. Pool vault (writable)
  6. Shares mint (writable)
  7. Destination custody — vault shares on deposit / vault TSLAx on redeem (writable)
  8. Token program (readonly)
- **CPI callee rule**: the mock program account rides in the outer ix (`mock_program`), otherwise the runtime cannot resolve the callee (`Unknown program` + `MissingAccount`)
- Mock `deposit` mints into pre-created custody (no `init`), so repeat deposits work

### Performance Fee Mechanics
On every `withdraw`:
1. Calculate `yield = out_amount - principal_equivalent`
2. `fee = yield * protocol_fee_bps / 10000`
3. Transfer `fee` from vault TSLAx custody → Treasury PDA
4. User receives `out_amount - fee`
5. Fee never exceeds 10% of yield; principal never touched

### Emergency Pause
- `is_paused: bool` in VaultState
- `deposit` and `withdraw` check `require!(!state.is_paused, VaultPaused)`
- `set_paused(bool)` admin-gated via `require_keys_eq(admin, state.admin)`

### Admin Transfer (Squads V4 Ready)
- `set_admin(new_admin: Pubkey)` updates `state.admin`
- Only current admin can execute
- New admin can be any Pubkey (wallet or Squads multisig)
- Immediate effect; no timelock (by design for hackathon)

### Pool Config Updates
- `update_mock_pool(new_pool, new_shares_mint)` — repoint the vault at a new pool
- `update_stub_price(price, expo)` — refresh the devnet oracle (creates PDA on first call)
- `update_kamino_config(...)` — legacy Kamino-era swap, superseded
- All admin-gated via `require_keys_eq(caller, state.admin)`; immediate effect

### Devnet Borrow Crank (`scripts/devnet-crank.ts`)
Documents the exact steps to drive Kamino utilization:
- **Current state**: 0% utilization, exchange rate 1.0
- **Obligation PDA**: `8xstbrA8uRJgMQvJGwHUZYdK6it8ToF7NKjdxpYqCpeB` (admin)
- **Discriminators documented**:
  - `initObligation`: `[251, 10, 231, 76, 27, 11, 159, 96]`
  - `depositObligationCollateral`: `[144, 87, 165, 214, 12, 94, 122, 240]`
  - `borrowObligationLiquidity`: `[121, 127, 18, 204, 73, 245, 225, 65]`
- Full account structures and execution sequence provided
- SDK version conflicts prevent automated execution; manual steps documented

## Mock Lender CPI Integration
- **Program**: `7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g` (Devnet)
- **Deposit discriminator**: `[169, 201, 30, 126, 6, 205, 102, 68]` (depositReserveLiquidity)
- **Redeem discriminator**: `[234, 117, 181, 125, 185, 142, 220, 29]` (redeemReserveCollateral)
- **Drip Yield discriminator**: `[234, 117, 181, 125, 185, 142, 220, 29]` (drip_yield)
- **Account order** (from mock_lender program):
  1. Owner (signer, readonly)
  2. Pool (writable)
  3. Shares mint (writable)
  4. User destination (writable)
  5. Token program (readonly)
  6. Instruction sysvar (readonly)

### Mock Lender Instructions
| Instruction | Purpose |
|-------------|---------|
| `initialize_pool` | Creates pool PDA, vault ATA, shares mint |
| `deposit_reserve_liquidity(amount)` | TSLAx → pool vault, mints shares |
| `redeem_reserve_collateral(shares)` | Burns shares, returns TSLAx (principal + yield) |
| `drip_yield(yield_amount)` | Admin adds TSLAx to pool vault (simulates yield) |

## Off-Chain Architecture (`app/`)

### Next.js 14 App Router
- `/` — Landing page (static)
- `/app` — Dashboard: Vault/Unvault/Zap tabs, chart, Trade card, history (dynamic)
- `/app/pool` — Meteora pool creator + liquidity seeder (dynamic)
- `/api/faucet` — TSLAx faucet (server-signed)
- `/api/zap` — Zap rates + payment-verified mint (server-signed)
- `/api/pyth/post` — Hermes VAA → post_update bundle builder
- `/api/webhooks/helius` — Enhanced webhook receiver + local event feed

### Wallet Integration
- `@solana/wallet-adapter-react` + Phantom only (`PhantomWalletAdapter`)
- Solflare / all other wallets removed by design
- `select(name)` + `connect()` flow (direct `adapter.connect()` bypasses state and broke connecting)
- `useWallet.sendTransaction` for vault ix

### Data Layer
| Module | Purpose | Source |
|--------|---------|--------|
| `vault.ts` | `deriveAddresses`, `buildDepositTx`, `buildWithdrawTx` (raw ix, trailing price_update, Hermes override) | On-chain PDAs + ATAs |
| `yield.ts` | `fetchPoolSnapshot()` → `{rate, apyPct, totals}` from mock Pool bytes | Mock pool account |
| `history.ts` | `fetchVaultHistory()` webhook-first + RPC fallback, deduped | `/api/webhooks/helius` + RPC |
| `errors.ts` | `friendlyError()` maps 15+ error codes | Anchor error codes + wallet/RPC patterns |
| `config.ts` | All addresses from `NEXT_PUBLIC_*` env vars | `.env.local` |

### UI Components
- **ThemeProvider** — dark/light (obsidian/zinc + emerald accents)
- **YieldChart** — Recharts AreaChart, localStorage history, live rate append
- **Toasts** — Bottom-center stack, auto-dismiss 6s, click to dismiss
- **OnboardingModal** — Shows once per wallet (localStorage), 1-click faucet (SOL best-effort)
- **JupiterZapModal** — SOL/USDC zap tab: Jupiter quote/swap or devnet mint fallback, bundle-or-sequential deposit
- **TradeCard** — Live nTSLA/USDC pair links (devnet Meteora + explorer)
- **Wallet Pill** — Green dot + truncated address, dropdown with disconnect

### Meteora Integration
- nTSLA/USDC DLMM pool live on Devnet: `3iCpUt4RPQ2gzjAN55w3tuar1Qa4YaH4qqD3LZxJtfUM` (0.25% fee, bin 25, price 1.0, seeded 10+10)
- Created + seeded via in-app `/app/pool` (custom-fee SDK flow; Meteora UI locks unverified tokens to 10%, DAMM V2 rejects them)
- Dashboard Trade card links to devnet Meteora + explorer
- No on-chain Meteora CPI in the vault program (frontend/SDK flow only)

### Devnet Crank
- `scripts/devnet-crank.ts` — state analysis + execution plan with discriminators
- No persistent crank yet; reserve utilization = 0 (no borrows)
- SDK version conflicts documented; manual execution steps provided

## Data Flows

### Deposit Flow (Pyth/stub-gated)
```
User Wallet (TSLAx)
       ↓ SPL transfer
Vault TSLAx Custody (vault authority ATA)
       ↓ CPI: deposit_reserve_liquidity (mock v2, pool PDA signs mint)
Mock Lender Pool (vault += amount, shares minted to vault custody)
       ↓ Shares delta measured → vault totals updated
nTSLA Mint (PDA authority) → User nTSLA ATA (1:1 vs delta, init_if_needed)
       ↓ UI refresh
Dashboard shows: Vaulted TSLAx, Pool yield, Total Value
```

### Withdraw Flow (Partial or Full)
```
User specifies TSLAx amount OR nTSLA shares
       ↓ Convert to shares if TSLAx amount (shares = amount / rate)
       ↓ Burn nTSLA from User ATA
       ↓ CPI: redeem_reserve_collateral (burn vault shares, pool pays vault custody)
Mock pool: shares burned → TSLAx released to Vault TSLAx Custody
       ↓ Measure TSLAx growth (after − before)
Calculate principal = shares × total_deposits / total_shares
yield = redeemed − principal; fee = yield × 1000 / 10000
       ↓ Transfer fee → Treasury PDA
       ↓ Transfer (redeemed − fee) → User TSLAx ATA
       ↓ Update totals, UI refresh
Dashboard updates: balances, yield chart, treasury revenue
```

### Yield Rate Calculation
```typescript
// yield.ts: fetchPoolSnapshot() reads Pool bytes directly (no Kamino SDK)
rate = (total_deposits + yield_accrued) / total_shares  // TSLAx per nTSLA
apyPct = yield_accrued / total_deposits * 100           // shown as Pool yield
```

### Zap-In Flow (SOL/USDC → TSLAx → nTSLA)
```
User picks SOL/USDC + amount
       ↓ Live Jupiter v6 quote (browser → quote-api, no key)
Route found → swap tx → bundle attempt (≤1200B) else sequential → deposit delta
No route (devnet: TSLAx has no liquidity) → POST /api/zap
       ↓ Pay treasury (SOL transfer / USDC transfer) → server verifies → mints TSLAx at labeled fixed rate (1 SOL = 10, 1 USDC = 1)
       ↓ Auto-deposit exact minted amount → nTSLA
```

## Security Architecture

### PDA Authority
- All vault-owned token accounts: authority = `vault-v2-authority` PDA
- No multisig yet; admin keypair holds upgrade authority
- `set_admin` prepares for Squads V4 migration

### Signer Validation
- `invoke_signed` with explicit seeds verified in handler
- `require_keys_eq!` pool/shares/mint/program checks against VaultState in handler
- `require_keys_eq` on all mint/account constraints

### Treasury Authority
- Treasury PDA owned by program, authority = `vault-v2-authority`
- Fee transfers use `invoke_signed` with vault authority seeds
- No external wallet can drain treasury

### Admin Authority
- Stored in `VaultState.admin`
- `set_paused` and `set_admin` require `require_keys_eq(caller, state.admin)`
- `WrongAdmin` error (6013) for unauthorized attempts

### Emergency Pause
- Single boolean flag, immediate effect
- Blocks `deposit` and `withdraw` (reads paused state)
- Does NOT block `set_paused` (admin can always unpause)
- Does NOT block `set_admin` (governance must remain accessible)

### Keypair Handling
- Admin keypair: `keypairs/nesrt-admin.json` (gitignored)
- Faucet keypair: same as admin (TSLAx mint authority), loaded in `/api/faucet` via `TSLAX_FAUCET_KEYPAIR` env
- No private keys in repo, no hardcoded secrets

### Environment Variables
```bash
# .env.example (committed)
SOLANA_RPC_URL=https://api.devnet.solana.com
TSLAX_MINT=
KAMINO_MARKET=
KAMINO_RESERVE=
KAMINO_CTOKEN_MINT=
KAMINO_SUPPLY_VAULT=
KAMINO_PROGRAM_ID=KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD
VAULT_PROGRAM_ID=
PYTH_PRICE_FEED=FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9
# Server-only (never NEXT_PUBLIC_)
TSLAX_FAUCET_KEYPAIR=
```

## External Dependencies (Verified Versions)

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@coral-xyz/anchor` | 0.30.1 | Anchor framework |
| `@solana/web3.js` | 1.99.0 | RPC, tx building |
| `@solana/spl-token` | 0.4.15 | Token operations |
| `@solana/wallet-adapter-*` | 0.9.x / 0.15.x | Wallet connection |
| `@pythnetwork/hermes-client` | 2.1.0 | Hermes REST (server route only; receiver SDK unloadable in this tree) |
| `@solana/kit` | 8.3.0 | (unused by yield path; pool read is raw bytes) |
| `pyth-solana-receiver-sdk` (Rust) | 0.1 | On-chain feed id + staleness + Full verification |
| `recharts` | 2.x | Yield trajectory chart |
| `next` | 14.2.5 | React framework |
| `react` | 18.3.1 | UI |
| `typescript` | 5.5.0 | Type safety |
| `anchor-cli` | 0.30.1 (built from source) | Program build/deploy |
| `cargo-build-sbf` | solana 4.2.2 toolchain | SBF compilation |
| `rustc` | 1.79.0 | Required for edition2024 deps |

## Build & Deploy Pipeline
```bash
# Smart contract
cd programs/vault
cargo build-sbf --manifest-path Cargo.toml  # via solana 4.2.2 cargo-build-sbf
solana program write-buffer target/deploy/vault.so
solana program upgrade <buffer> <program-id>

# Mock lender
cd programs/mock_lender
cargo build-sbf --manifest-path Cargo.toml
solana program write-buffer target/deploy/mock_lender.so
solana program upgrade <buffer> <program-id>

# IDL (hand-maintained, discriminators sha256-verified)
cp target/idl/vault.json app/src/idl/vault.json
cp target/types/vault.ts app/src/../types/vault.ts

# Frontend
cd app
npm run build  # zero TS errors required
npm run dev    # localhost:3000
```

## Deployment Addresses (Devnet, Verified)

| Component | Address |
|-----------|---------|
| TSLAx Mint | `4Dimn4s78herJKGhD3oxMMGbZcjirgwt376tdjq4HevA` |
| Vault Program | `DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB` |
| Vault State PDA | `GjyzrgQMW6UPGhaqXzCkBi9aBhYnBQoYQZX4ZjZanwun` |
| Vault Authority PDA | `2as7mvTetsHFnArTWfTJu1h4esKrpNDAqyH1zW8vsNor` |
| Receipt (nTSLA) Mint | `AMXCrrSXNASso6ANoFsk2zAPUKimGvcCagVfx4Ev5hRA` |
| Treasury PDA | `CEHuKwAgZp4aaynTo1oivCYT7nRGnWVRW9kSGd5MLmM4` (0.022056 TSLAx skimmed) |
| Pyth Stub PDA | `2cXuUBQRjeDTJMCXVrq17VrS36spJcyXhxP6AE3HfKoZ` (TSLAx/USD, admin-posted) |
| Admin / Upgrade Authority | `J28vmQF8RPKnvcy1tZLxBAxmqxwYwvak56nMmfMGYLc3` |
| Mock Lender v2 Program | `7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g` |
| Mock Lender Pool PDA | `6TdFhCAHbod21bm7BCenz3fEAgfTQr1BGri7Mzjie9Nx` (30.2 TSLAx deposits, 0.479 yield accrued) |
| Mock Lender Shares Mint | `6s2qM9MbCgcZzfdEmYt9PnvoYLpuF91PGCZ3T5noquAg` |
| Meteora LB Pair (nTSLA/USDC) | `3iCpUt4RPQ2gzjAN55w3tuar1Qa4YaH4qqD3LZxJtfUM` (0.25% fee, seeded 10+10) |
| Kamino Market/Reserve (superseded) | `GjyuKPft2jBXy5aB32VWcWY5cc6jvAFcQozW6SkS7hSG` / `24EfeXj3XyLLE6GThh8ik4vcxEPMooAU5XXDL5nJHEr8` |

## Known Limitations (Devnet)
- **Kamino TSLAx Reserve**: No TSLAx reserve exists on devnet Kamino. The vault's Kamino config points to a SOL reserve placeholder. Yield activation requires Kamino to onboard TSLAx on devnet (not permissionless). This is an infrastructure limitation, not a code gap.
- **SOL Reserve**: A native SOL reserve exists on devnet but its collateral mint was never initialized, making it unusable for deposits.
- **Build Toolchain**: `cargo-build-sbf` v1.41 (rustc 1.75) has edition2024 compatibility issues with newer dependencies. Program builds against pinned anchor 0.30.1; rebuild requires nightly or version alignment.
- **Mock Lender (Active)**: Deployed lightweight Anchor program (`7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g`) simulating Kamino CPI interface. E2E-verified live (deposit → mock_lender → nTSLA mint, drip → withdraw → principal + yield, 10% treasury skim; 6/6 tests pass).

## Hackathon Completion Status
**Backend Protocol: COMPLETE** ✅
- 11 instructions deployed and tested (including `update_kamino_config`)
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
- Dashboard builds cleanly
- Wallet connect, deposit/withdraw flow, yield tracking
- Meteora pool discoverability
- Error handling, onboarding

**Documentation: COMPLETE** ✅
- PRD, Architecture, Handoff updated
- All discriminators and account structures documented