# Issues — RESOLVED ✅ (mock v2 live, E2E verified)

> **Resolution (2026-09-18):** v1 program `FNNnpuFM5WaGKYWQKVDBNysY8LtqpL6saREQeZP5uDTL` could not be upgraded (authority `GqdFsQSu49wJBYUR73pY5gC7V9B8Zzf9DCQqFa5CkPXG` not in repo). Deployed fresh mock v2 `7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g` (admin upgrade authority), fixed vault↔mock CPI (vault-scoped accounts, `mock_program` in outer ix, writable `user` meta), initialized pool/treasury, E2E-verified deposit→drip→withdraw with 10% skim, 6/6 tests pass. Original write-up preserved below for history.

# Current Issues Blocking Deployment

## Root Cause: Program ID Mismatch & Deploy Authority Funding

### The Core Problem
The mock_lender program was **deployed at `FNNnpuFM5WaGKYWQKVDBNysY8LtqpL6saREQeZP5uDTL`** but the **source code declared `2ZSbmEXRNSy99JA7QaBcBKtU1ppDqHjLxym9GdTfZYCX`**. This caused `DeclaredProgramIdMismatch` (Anchor error 4100) when trying to initialize the pool.

### What Happened
1. **Initial deploy**: Program deployed at `FNNnpuFM5WaGKYWQKVDBNysY8LtqpL6saREQeZP5uDTL` with deploy authority `2ZSbmEXRNSy99JA7QaBcBKtU1ppDqHjLxym9GdTfZYCX` (key not in repo — redacted)
2. **Source code had wrong declare_id**: The Rust code declared `2ZSbmEXRNSy99JA7QaBcBKtU1ppDqHjLxym9GdTfZYCX` instead of the actual deployed address
3. **Fixed source code**: Updated `declare_id!("FNNnpuFM5WaGKYWQKVDBNysY8LtqpL6saREQeZP5uDTL")` and rebuilt
4. **Now need to UPGRADE**: The existing program at `FNNnpuFM5WaGKYWQKVDBNysY8LtqpL6saREQeZP5uDTL` must be upgraded with the new binary
5. **Upgrade requires buffer account**: Creating a buffer account costs ~1.47 SOL rent-exempt
6. **Deploy authority has only 1.6 SOL**: After fees, insufficient for buffer creation

### Account Status

| Account | Role | Balance | Status |
|---------|------|---------|--------|
| `2ZSbmEXRNSy99JA7QaBcBKtU1ppDqHjLxym9GdTfZYCX` | Mock lender deploy authority | 1.6 SOL | **Insufficient for upgrade buffer** |
| `FNNnpuFM5WaGKYWQKVDBNysY8LtqpL6saREQeZP5uDTL` | Mock lender program (LIVE) | 1.47 SOL | Needs upgrade with new binary |
| `DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB` | Vault program (LIVE) | 1.8 SOL | Upgraded successfully |
| `J28vmQF8RPKnvcy1tZLxBAxmqxwYwvak56nMmfMGYLc3` | Admin wallet | 1.8 SOL | Can fund but not deploy authority |

### Why "Upgrading Again"?
- The program **already exists on-chain** at `FNNnpuFM5WaGKYWQKVDBNysY8LtqpL6saREQeZP5uDTL`
- Changing `declare_id` in source code **doesn't change the on-chain program**
- Must **upgrade** the existing program with new binary via buffer account
- Buffer creation = new rent-exempt account = ~1.47 SOL

### Solution Options

**Option A: Fund deploy authority** (simplest)
```bash
# Send ~1 SOL to deploy authority
solana transfer 2ZSbmEXRNSy99JA7QaBcBKtU1ppDqHjLxym9GdTfZYCX 1 --url devnet --keypair <your-funded-wallet>
# Then upgrade
solana program write-buffer /home/uyscutty/projects/nesrt/target/deploy/mock_lender.so --url devnet --keypair /tmp/original_final.json
solana program upgrade <BUFFER> FNNnpuFM5WaGKYWQKVDBNysY8LtqpL6saREQeZP5uDTL --url devnet --keypair /tmp/original_final.json
```

**Option B: Use admin wallet as new upgrade authority** (requires program migration)
- Close current program, reclaim SOL, redeploy with admin as authority

**Option C: Deploy fresh program** (cleanest but new program ID)
- Close `FNNnpuFM5WaGKYWQKVDBNysY8LtqpL6saREQeZP5uDTL`, reclaim 1.47 SOL
- Deploy new program with correct declare_id from start

### Immediate Next Steps
1. Fund `2ZSbmEXRNSy99JA7QaBcBKtU1ppDqHjLxym9GdTfZYCX` with ~1 SOL
2. Upgrade mock_lender program
3. Initialize pool (create pool PDA, vault ATA, shares mint)
4. Update vault config to point to new pool
5. Run integration tests
6. Drip yield & verify

### Files to Update After Fix
- `Anchor.toml` - mock_lender program ID
- `programs/vault/src/lib.rs` - mock_lender::PROGRAM_ID constant
- `docs/prd.md`, `docs/architecture.md`, `docs/handoff.md` - status
- `README.md` - current state