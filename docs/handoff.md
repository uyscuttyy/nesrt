# Handoff

## Status
- [x] Phase 1: Project init + git setup.
- [~] Phase 2: Devnet env script written + validated to funding gate; BLOCKED on admin SOL (0 balance, faucet throttled, slow retry loop running). Fund J28vmQF8RPKnvcy1tZLxBAxmqxwYwvak56nMmfMGYLc3 to unblock.
- [~] Phase 3: Vault state + PDAs + initialize written; build verification waits on Anchor 0.30.1 install.
- [ ] Phases 4-5: Deposit/withdraw CPI (discriminators captured, design settled).
- [ ] Phase 6: Contract tests.
- [ ] Phases 7-9: Frontend (wallet + landing, dashboard, yield tracking).
- [ ] Phase 10: E2E polish + docs.

## Key findings (verified against klend program source)
- KLend devnet program = KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD (same as mainnet, verified executable on devnet).
- `init_reserve` takes no oracle config; config (incl. status Active) comes via update_reserve_config.
- `depositReserveLiquidity` / redeem refresh interest with price=None: vault flow never touches an oracle.
- Mock asset has no Scope/Pyth feed, so reserve is supply-only (LTV 0, borrows 0, placeholder Pyth key). Honest consequence: supply APY is 0 until a real feed + borrowers exist. cToken mechanics and exchange rate are fully real.
- kamino-manager CLI has no --devnet for add-asset-to-market, so setup_devnet.ts uses the SDK library directly.

## Blockers / notes
- Anchor build/test verification waits on `avm install 0.30.1` (running).
- Kamino Devnet program ID + SDK API pinned in Phase 2 from official docs.
- Open: Nimiq Pay mini-app Solana provider availability (runtime detection
  planned; fallback path TBD if EVM-only).
