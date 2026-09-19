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
│   └── mock_lender/           # Mock Kamino CPI (Rust)
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
│       │   ├── yield.ts            # Kamino reserve fetch
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
    pub kamino_market: Pubkey,            // KLend market
    pub kamino_reserve: Pubkey,           // TSLAx reserve in market
    pub kamino_ctoken_mint: Pubkey,       // cToken mint for TSLAx reserve
    pub authority_bump: u8,               // Vault authority PDA bump
    pub state_bump: u8,                   // VaultState PDA bump
    pub is_paused: bool,                  // Emergency circuit breaker
    pub pyth_price_feed: Pubkey,          // Pyth Devnet TSLA/USD feed
    pub protocol_fee_bps: u16,            // 1000 = 10%
    pub treasury: Pubkey,                 // Treasury PDA
}
```
**SPACE**: 272 bytes (8 disc + 32×10 + 1 + 1 + 2 + 32)

#### Vault Authority PDA (`["vault-v2-authority", tslax_mint]`)
- Signer-only PDA (never writable)
- Owns: vault TSLAx custody, vault cToken custody, nTSLA mint authority
- Signs Kamino CPI via `invoke_signed` with seeds `["vault-v2-authority", tslax_mint, bump]`

#### Receipt Mint PDA (`["receipt-mint-v2", tslax_mint]`)
- 6 decimals, mint authority = vault-v2-authority
- nTSLA tokens minted 1:1 against cTokens received on deposit
- Burned proportionally on withdrawal

#### Treasury PDA (`["treasury", tslax_mint]`)
- Program-owned token account for TSLAx
- Accumulates 10% of yield on each withdrawal
- Authority = vault-v2-authority (program-controlled)

#### Custody Token Accounts
- **Vault TSLAx** (`["vault-v2-tslax", tslax_mint]`): Holds deposited TSLAx before Kamino supply
- **Vault cToken** (`["vault-v2-ctoken", tslax_mint]`): Holds cTokens from Kamino (yield position)

### Instructions

| Instruction | Purpose | Key Constraints |
|-------------|---------|-----------------|
| `initialize_state` | Legacy init (vault seed) | Admin only |
| `initialize_state_v2` | Full init with new layout | Creates VaultState, sets all fields |
| `initialize_mint` | Creates nTSLA receipt mint | `init` constraint, auth = vault-v2-authority |
| `init_custody` | Creates vault TSLAx + cToken ATAs | Verifies mints match state |
| `deposit(amount)` | User TSLAx → Kamino → nTSLA | Pause guard, Kamino verify, mints 1:1 |
| `withdraw(shares)` | nTSLA → Kamino redeem → TSLAx | Pause guard, share validation, fee skim |
| `set_paused(paused)` | Emergency pause toggle | Admin only, `WrongAdmin` check |
| `set_admin(new_admin)` | Transfer authority to Squads | Admin only |
| `update_kamino_config` | Update market/reserve/ctoken/pyth | Admin only, full config swap |
| `migrate_state` | Close old PDA | Admin only |
| `close_vault_state_v2` | Close v2 PDA | Admin only |
| `allocate_vault_state` | Reallocate old PDA | System program Allocate |

### Kamino CPI Integration
- **Program**: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`
- **Deposit discriminator**: `a9c91e7e06cd6644` (supplyReserveLiquidity)
- **Redeem discriminator**: `ea75b57db98edc1d` (redeemReserveCollateral)
- **Account order** (verified against klend source):
  1. Owner (signer, readonly)
  2. Market (readonly)
  3. Reserve (writable)
  4. Market authority (readonly)
  5. Liquidity mint (readonly)
  6. Reserve liquidity supply (writable)
  7. Collateral mint (writable)
  8. User source (writable)
  9. User destination (writable)
  10. Token program (readonly) ×2
  11. Instruction sysvar (readonly)

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

### Update Kamino Config
- `update_kamino_config(new_market, new_reserve, new_ctoken_mint, new_pyth_feed)`
- Admin-gated via `require_keys_eq(caller, state.admin)`
- Allows switching reserves (e.g., for Devnet demo with SOL reserve)
- Immediate effect; no migration needed

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
- `/app` — Dashboard (client component, dynamic)
- `/api/faucet` — Server route, signs with faucet keypair

### Wallet Integration
- `@solana/wallet-adapter-react` + Phantom only (`PhantomWalletAdapter`)
- Solflare / all other wallets removed by design
- `select(name)` + `connect()` flow (direct `adapter.connect()` bypasses state and broke connecting)
- `useWallet.sendTransaction` for vault ix

### Data Layer
| Module | Purpose | Source |
|--------|---------|--------|
| `vault.ts` | `deriveAddresses`, `buildDepositTx`, `buildWithdrawTx` (raw ix, mock_lender order) | On-chain PDAs + ATAs |
| `yield.ts` | `fetchPoolSnapshot()` → `{rate, apyPct, totals}` from mock Pool bytes | Mock pool account |
| `history.ts` | `fetchVaultHistory()` with new `amount=/shares_minted=` + `tslax_out=` regex + legacy fallback | RPC signature parsing |
| `errors.ts` | `friendlyError()` maps 15+ error codes | Anchor error codes + wallet/RPC patterns |
| `config.ts` | All addresses from `NEXT_PUBLIC_*` env vars | `.env.local` |

### UI Components
- **ThemeProvider** — dark/light (obsidian/zinc + emerald accents)
- **YieldChart** — Recharts AreaChart, localStorage history, live rate append
- **Toasts** — Bottom-center stack, auto-dismiss 6s, click to dismiss
- **OnboardingModal** — Shows once per wallet (localStorage), 1-click faucet
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

### Deposit Flow
```
User Wallet (TSLAx)
       ↓ SPL transfer
Vault TSLAx Custody (PDA)
       ↓ CPI: supplyReserveLiquidity (Kamino) OR depositReserveLiquidity (mock_lender)
Kamino Reserve / Mock Lender Pool
       ↓ cToken / Shares delta measured
nTSLA Mint (PDA authority) → User nTSLA ATA (1:1 vs delta)
       ↓ UI refresh
Dashboard shows: Vaulted TSLAx, nTSLA balance, Position Value = nTSLA × rate
```

### Withdraw Flow (Partial or Full)
```
User specifies TSLAx amount OR nTSLA shares
       ↓ Convert to shares if TSLAx amount (shares = amount / rate)
       ↓ Burn nTSLA from User ATA
       ↓ CPI: redeemReserveCollateral (shares)
Kamino Reserve / Mock Lender Pool: cTokens/Shares burned → TSLAx released to Vault TSLAx Custody
       ↓ Measure TSLAx delta
Calculate yield = delta - principal_equivalent
fee = yield × 1000 / 10000
       ↓ Transfer fee → Treasury PDA
       ↓ Transfer (delta - fee) → User TSLAx ATA
       ↓ UI refresh
Dashboard updates: balances, yield chart, treasury revenue
```

### Yield Rate Calculation
```typescript
// yield.ts: fetchReserveSnapshot()
rate = reserve.liquidity.totalAvailableAmount / reserve.collateral.mintTotalSupply
// Unitless ratio: TSLAx per nTSLA (starts at 1.0, grows with yield)
```

## Security Architecture

### PDA Authority
- All vault-owned token accounts: authority = `vault-v2-authority` PDA
- No multisig yet; admin keypair holds upgrade authority
- `set_admin` prepares for Squads V4 migration

### Signer Validation
- `invoke_signed` with explicit seeds verified in handler
- `kamino::verify_reserve_accounts` checks all CPI accounts match state
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
| `@kamino-finance/klend-sdk` | 12.0.0 | Reserve types (off-chain read only) |
| `@solana/kit` | 8.3.0 | `Reserve.fetch` for yield rate |
| `pyth-sdk` / `pyth-client` | — | Price feed (stored, not yet read on-chain) |
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
| Kamino Market | `GjyuKPft2jBXy5aB32VWcWY5cc6jvAFcQozW6SkS7hSG` |
| Kamino Reserve | `24EfeXj3XyLLE6GThh8ik4vcxEPMooAU5XXDL5nJHEr8` |
| cToken Mint | `7zbpLvXSXipfgFn4XJeZWbw2F2nHaoAmMaJTPebiTpoU` |
| Reserve Supply Vault | `7pF71D7m2NTmX8cFwvUbLFuoqinWmdzYndCHPekCuRTb` |
| Vault Program | `DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB` |
| Pyth TSLA Feed | `FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9` |
| Vault State PDA (v2) | `GjyzrgQMW6UPGhaqXzCkBi9aBhYnBQoYQZX4ZjZanwun` |
| Vault Authority PDA | `2as7mvTetsHFnArTWfTJu1h4esKrpNDAqyH1zW8vsNor` |
| Receipt Mint (v2) | `GYoTAg6bicNQcUk2R31JUFxZieSNbm93yGHgcCTw4rjS` |
| Vault TSLAx Custody | `Ho5YRt373tZkpMN4UXbyqpYbS3NhUovo2DSuMHUnEtTE` |
| Vault cToken Custody | `DcWmEkL2sbGwVynSvzR1x4YgfwCtsuEsHXokRB6sBh9j` |
| Treasury PDA | `6gN5rpat4vDVJkFciTQjVp23QzeJh67GtUm8myjfeBrg` |
| Admin / Upgrade Authority | `J28vmQF8RPKnvcy1tZLxBAxmqxwYwvak56nMmfMGYLc3` |
| Obligation PDA (admin) | `8xstbrA8uRJgMQvJGwHUZYdK6it8ToF7NKjdxpYqCpeB` |
| Mock Lender Program | `7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g` |
| Mock Lender Pool PDA | `6TdFhCAHbod21bm7BCenz3fEAgfTQr1BGri7Mzjie9Nx` |
| Mock Lender Shares Mint | `6s2qM9MbCgcZzfdEmYt9PnvoYLpuF91PGCZ3T5noquAg` |
| Mock Lender Vault ATA | `6suncjAX9zZ9S44NH3t5LESriEVRJS8FYGoUXkr5osmc` |

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