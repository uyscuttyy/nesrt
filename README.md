# Nesrt — Yield Vault for Tokenized Equities (Devnet)

**One-click yield for tokenized equities on Solana.**  
Deposit TSLAx → receive liquid nTSLA receipt tokens → protocol routes collateral into the Nesrt lending pool → earn lending yield → 10% performance fee to treasury → withdraw anytime.

---

## Current Status (Devnet)

| Component | Status |
|-----------|--------|
| **Smart Contract** | ✅ Deployed: `DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB` |
| **Vault State (v2)** | ✅ Populated — admin, pause, fee, treasury, Pyth feed |
| **Kamino CPI (deposit/withdraw)** | ✅ 6/6 integration tests pass |
| **Partial Withdrawals** | ✅ By shares, proportional yield |
| **Emergency Pause** | ✅ `set_paused` / `VaultPaused` error |
| **Admin Transfer** | ✅ `set_admin` / `WrongAdmin` error |
| **10% Performance Fee** | ✅ Treasury PDA, skim on withdraw |
| **Pyth Price Feed** | ✅ Stored in VaultState |
| **Frontend Build** | ✅ Clean (zero TypeScript errors) |
| **Dashboard** | ✅ Live balances, yield chart, history, reserve health |
| **Faucet (SOL + TSLAx)** | ✅ Server route, live tested |
| **Meteora Pool** | ⚠️ Manual creation (DLMM SDK bugs) |
| **Squads V4 Multisig** | ✅ Created, admin transferred, verified on-chain |
| **Update Kamino Config** | ✅ `update_kamino_config` instruction added |
| **Real APY** | ✅ Live — mock v2 pool with drip yield (E2E-verified) |

---

## Architecture Overview

```
Wallet (Phantom) 
    │
    ▼
Nesrt Vault (Anchor)
    │
    ▼
Kamino Lend (CPI)
    │
    ▼
nTSLA Mint (1:1 vs cTokens)
    │
    ▼
Meteora DLMM Pool (nTSLA/USDC)
```

### Key PDAs (Derivable)

| PDA | Seeds | Address |
|-----|-------|---------|
| VaultState v2 | `["vault-v2", tslax_mint]` | `GjyzrgQMW6UPGhaqXzCkBi9aBhYnBQoYQZX4ZjZanwun` |
| Vault Authority | `["vault-v2-authority", tslax_mint]` | `2as7mvTetsHFnArTWfTJu1h4esKrpNDAqyH1zW8vsNor` |
| nTSLA Mint v2 | `["receipt-mint-v2", tslax_mint]` | `GYoTAg6bicNQcUk2R31JUFxZieSNbm93yGHgcCTw4rjS` |
| Vault TSLAx | `["vault-v2-tslax", tslax_mint]` | `Ho5YRt373tZkpMN4UXbyqpYbS3NhUovo2DSuMHUnEtTE` |
| Vault cToken | `["vault-v2-ctoken", tslax_mint]` | `DcWmEkL2sbGwVynSvzR1x4YgfwCtsuEsHXokRB6sBh9j` |
| Treasury | `["treasury", tslax_mint]` | `F3y3LsqVFLFVESdS6vrGvK3Yj9sKByG9mUnBzvrUKfZA` |

---

## Quickstart

```bash
# 1. Install deps
npm install

# 2. Configure env (copy example, fill Devnet addresses)
cp .env.example .env.local

# 3. Run frontend
cd app && npm run dev    # http://localhost:3000
```

### Smart Contract (separate terminal)

```bash
# Build (needs solana 4.2.2 cargo-build-sbf)
export PATH="$HOME/.local/share/solana/install/releases/stable-e29e5d910f0c2b7176f58174e592e8488099ef75/solana-release/bin:$PATH"
cargo build-sbf --manifest-path programs/vault/Cargo.toml

# Deploy
solana program write-buffer target/deploy/vault.so --url devnet --keypair keypairs/nesrt-admin.json
solana program upgrade <BUFFER> DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB --url devnet --keypair keypairs/nesrt-admin.json

# Run tests
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=$PWD/keypairs/nesrt-admin.json
./node_modules/.bin/ts-mocha -p tsconfig.json -t 1000000 tests/vault.ts
```

---

## Repository Structure

```
nesrt/
├── programs/vault/          # Anchor program (Rust)
│   └── src/lib.rs           # All instructions + state
├── app/                     # Next.js 14 frontend
│   ├── src/
│   │   ├── app/             # Landing + Dashboard + API routes
│   │   ├── components/      # YieldChart, Toasts, OnboardingModal
│   │   ├── lib/             # vault.ts, yield.ts, history.ts, errors.ts
│   │   └── idl/vault.json   # Hand-maintained IDL
├── scripts/
│   ├── devnet-crank.ts      # Kamino borrow crank analysis + discriminators
│   ├── create-meteora-pool.ts   # Meteora pool creation (SDK bugs)
│   ├── create-squads-multisig.ts # Squads V4 multisig creation (working)
│   ├── transfer-admin-to-multisig.ts # Admin transfer (working)
│   ├── execute-sol-crank.ts     # SOL reserve crank attempt
│   └── verify_*.cjs         # Phase 3 verification
├── tests/vault.ts           # Anchor integration tests (6/6 pass)
├── docs/
│   ├── prd.md               # Product Requirements
│   ├── architecture.md      # Technical Architecture
│   └── handoff.md           # Engineering Handoff
└── setup/                   # One-time Devnet setup (mint, market, reserve)
```

---

## Key Scripts

```bash
# Phase 2: Borrow crank state analysis (shows plan + discriminators)
npx tsx scripts/devnet-crank.ts

# Phase 3: Create Meteora nTSLA/USDC pool (manual fallback documented)
npx tsx scripts/create-meteora-pool.ts

# Phase 5: Create Squads V4 multisig (works)
npx tsx scripts/create-squads-multisig.ts

# Transfer admin to multisig (works, verified on-chain)
npx tsx scripts/transfer-admin-to-multisig.ts

# Verify pause/admin logic
node scripts/verify_phase3.cjs
node scripts/verify_pause_guard.cjs paused-deposit
```

---

## Devnet Addresses (Verified)

| Component | Address |
|-----------|---------|
| TSLAx Mint | `4Dimn4s78herJKGhD3oxMMGbZcjirgwt376tdjq4HevA` |
| Kamino Market | `GjyuKPft2jBXy5aB32VWcWY5cc6jvAFcQozW6SkS7hSG` |
| Kamino Reserve (SOL placeholder) | `24EfeXj3XyLLE6GThh8ik4vcxEPMooAU5XXDL5nJHEr8` |
| cToken Mint | `7zbpLvXSXipfgFn4XJeZWbw2F2nHaoAmMaJTPebiTpoU` |
| Pyth TSLA Feed | `FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9` |
| Vault Program | `DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB` |
| Squads Multisig | `EuFKrjdgTJ4G4fnU3VWLhmiWb1LN9JcCMUJD6Q4mumdG` |
| Admin / Upgrade Authority | `J28vmQF8RPKnvcy1tZLxBAxmqxwYwvak56nMmfMGYLc3` |

---

## Known Limitations (Honest Assessment)

1. **Kamino gap bypassed with mock v2** — No TSLAx reserve exists on devnet Kamino (external infra gap). The vault now routes into mock v2 `7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g` (pool `6TdFhCAHbod21bm7BCenz3fEAgfTQr1BGri7Mzjie9Nx`), E2E-verified with real drip yield. Old v1 `FNNnpuFM5WaGKYWQKVDBNysY8LtqpL6saREQeZP5uDTL` superseded (authority key not in repo).

2. **Meteora Pool** — DLMM SDK has bugs (`binStep.toArrayLike`, `binId.divmod`); manual UI creation required. Frontend has the Trade tab link ready.

3. **Pyth On-Chain** — Feed stored in VaultState but not validated in CPI; would need pyth-sdk in the program.

4. **Helius Webhooks** — Not integrated; polling fallback in `history.ts`.

5. **Build Toolchain** — `anchor build` has edition2024 compatibility issues; program built with `cargo-build-sbf` from solana 4.2.2. IDL is hand-maintained.

---

## Documentation

- **PRD**: `docs/prd.md` — Product requirements, user journey, status table
- **Architecture**: `docs/architecture.md` — Full technical architecture, data flows, security model
- **Handoff**: `docs/handoff.md` — Engineering handoff with commands, PDAs, test results, blockers

---

## Test Results

```bash
$ ./node_modules/.bin/ts-mocha -p tsconfig.json -t 1000000 tests/vault.ts
  ✔ initializes vault state
  ✔ initializes the receipt mint
  ✔ initializes vault custody accounts
  ✔ deposits TSLAx and mints yTSLAx 1:1 with cTokens
  ✔ rejects zero-amount deposits
  ✔ withdraws the full position back to TSLAx
  6 passing (17s)
```

---

## Security

- **PDA Authority**: All vault token accounts owned by `vault-v2-authority` PDA
- **Signer Validation**: `invoke_signed` with explicit seeds, `kamino::verify_reserve_accounts`
- **Treasury**: Program-owned, authority = vault PDA, fee skim on withdraw only
- **Admin**: Multisig controls all admin functions; `set_admin` executed, verified on-chain
- **Pause**: Instant `is_paused` flag blocks deposit/withdraw
- **No Private Keys in Repo**: Keypairs in `keypairs/` (gitignored), env vars for faucet

---

## License

MIT — Experimental Devnet software. Not audited. No mainnet value.