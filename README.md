# Nesrt — Yield Vault for Tokenized Equities (Devnet)

**One-click yield abstraction for tokenized equities on Solana Devnet.**  
Deposit TSLAx → receive liquid nTSLA receipt tokens → protocol routes collateral into Kamino Lend → earn lending yield → 10% performance fee to treasury → withdraw anytime or trade nTSLA on Meteora DLMM.

---

## 🎯 Current Status (Devnet)

| Component | Status |
|-----------|--------|
| **Smart Contract** | ✅ Deployed: `DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB` |
| **Vault State (v2)** | ✅ Populated: admin, pause, fee, treasury, Pyth feed |
| **Kamino CPI (deposit/withdraw)** | ✅ 6/6 integration tests pass |
| **Partial Withdrawals** | ✅ By shares, proportional yield |
| **Emergency Pause** | ✅ `set_paused` / `VaultPaused` |
| **Admin Transfer** | ✅ `set_admin` / `WrongAdmin` |
| **10% Performance Fee** | ✅ Treasury PDA, skim on withdraw |
| **Pyth Price Feed** | ✅ Stored in VaultState |
| **Frontend Build** | ✅ Clean (zero TS errors) |
| **Dashboard** | ✅ Live balances, yield chart, history, health |
| **Faucet (SOL + TSLAx)** | ✅ Server route, live tested |
| **Meteora Pool** | ⚠️ Manual creation required (SDK bugs) |
| **Squads V4 Multisig** | ⚠️ V2 instruction blocked (SDK issue) |
| **Real APY** | 0% (no borrows — need crank) |

---

## 🏗 Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Wallet    │────▶│  Nesrt Vault │────▶│ Kamino Lend │
│  (Phantom)  │     │  (Anchor)    │     │  (CPI)      │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │  nTSLA Mint │  (1:1 vs cTokens)
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Meteora    │  (nTSLA/USDC DLMM)
                    │  DLMM Pool  │
                    └─────────────┘
```

### Key PDAs (Derivable)
| PDA | Seeds | Address |
|-----|-------|---------|
| VaultState v2 | `["vault-v2", tslax_mint]` | `GjyzrgQM...` |
| Vault Authority | `["vault-v2-authority", tslax_mint]` | `2as7mvT...` |
| nTSLA Mint v2 | `["receipt-mint-v2", tslax_mint]` | `GYoTAg6...` |
| Vault TSLAx | `["vault-v2-tslax", tslax_mint]` | `Ho5YRt3...` |
| Vault cToken | `["vault-v2-ctoken", tslax_mint]` | `DcWmEkL...` |
| Treasury | `["treasury", tslax_mint]` | `6gN5rpa...` |

---

## 🚀 Quickstart

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

## 📁 Repository Structure

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
│   ├── devnet-crank.ts      # Kamino borrow crank (analysis + discriminators)
│   ├── create-meteora-pool.ts   # Meteora pool creation (SDK bugs)
│   ├── create-squads-multisig.ts # Squads V4 multisig creation
│   └── verify_*.cjs         # Phase 3 verification
├── tests/vault.ts           # Anchor integration tests (6/6 pass)
├── docs/
│   ├── prd.md               # Product Requirements
│   ├── architecture.md      # Technical Architecture
│   └── handoff.md           # Engineering Handoff
└── setup/                   # One-time Devnet setup (mint, market, reserve)
```

---

## 🔧 Key Scripts

```bash
# Phase 2: Borrow crank state analysis (run after setup)
npx tsx scripts/devnet-crank.ts

# Phase 3: Create Meteora nTSLA/USDC pool (manual fallback documented)
npx tsx scripts/create-meteora-pool.ts

# Phase 5: Create Squads V4 multisig
npx tsx scripts/create-squads-multisig.ts

# Verify pause/admin logic
node scripts/verify_phase3.cjs
node scripts/verify_pause_guard.cjs paused-deposit
```

---

## 🔑 Devnet Addresses (Verified)

| Component | Address |
|-----------|---------|
| TSLAx Mint | `4Dimn4s78herJKGhD3oxMMGbZcjirgwt376tdjq4HevA` |
| Kamino Market | `GjyuKPft2jBXy5aB32VWcWY5cc6jvAFcQozW6SkS7hSG` |
| Kamino Reserve | `24EfeXj3XyLLE6GThh8ik4vcxEPMooAU5XXDL5nJHEr8` |
| cToken Mint | `7zbpLvXSXipfgFn4XJeZWbw2F2nHaoAmMaJTPebiTpoU` |
| Pyth TSLA Feed | `FsJ3a3u21pM44F24FLxjv8v3NQEw9M59rxJi1aE4Z8U9` |
| Vault Program | `DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB` |
| Admin / Upgrade Authority | `J28vmQF8RPKnvcy1tZLxBAxmqxwYwvak56nMmfMGYLc3` |

---

## ⚠️ Known Limitations

1. **0% APY** — Kamino reserve has no borrows (no oracle + no crank). Run `scripts/devnet-crank.ts` for manual steps.
2. **Squads V4** — `multisigCreateV2` instruction has NULL createKey signer; V1 deprecated.
3. **Meteora Pool** — DLMM SDK has `binStep.toArrayLike` / `binId.divmod` bugs; manual UI creation required.
4. **Pyth On-Chain** — Feed stored but not validated in CPI; needs pyth-sdk in program.
5. **Helius Webhooks** — Not integrated; polling fallback in `history.ts`.

---

## 📚 Documentation

- **PRD**: `docs/prd.md` — Product requirements, user journey, status table
- **Architecture**: `docs/architecture.md` — Full technical architecture, data flows, security model
- **Handoff**: `docs/handoff.md` — Engineering handoff with commands, PDAs, test results, blockers

---

## 🧪 Test Results

```bash
$ anchor test
  ✔ initializes vault state
  ✔ initializes the receipt mint
  ✔ initializes vault custody accounts
  ✔ deposits TSLAx and mints yTSLAx 1:1 with cTokens
  ✔ rejects zero-amount deposits
  ✔ withdraws the full position back to TSLAx
  6 passing (17s)
```

---

## 🔒 Security

- **PDA Authority**: All vault token accounts owned by `vault-v2-authority` PDA
- **Signer Validation**: `invoke_signed` with explicit seeds, `kamino::verify_reserve_accounts`
- **Treasury**: Program-owned, authority = vault PDA, fee skim on withdraw only
- **Admin**: Single keypair (upgrade authority); `set_admin` prepares for Squads V4
- **Pause**: Instant `is_paused` flag blocks deposit/withdraw
- **No Private Keys in Repo**: Keypairs in `keypairs/` (gitignored), env vars for faucet

---

## 📝 License

MIT — Experimental Devnet software. Not audited. No mainnet value.