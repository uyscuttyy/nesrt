# Handoff

## Status
- [x] Phase 1: Project init + git setup (this commit).
- [ ] Phase 2: Devnet env (TSLAx mint + Kamino reserve script).
- [ ] Phases 3-5: Vault program (state, deposit CPI, withdraw CPI).
- [ ] Phase 6: Contract tests.
- [ ] Phases 7-9: Frontend (wallet + landing, dashboard, yield tracking).
- [ ] Phase 10: E2E polish + docs.

## Blockers / notes
- Rust/Solana/Anchor toolchain installing (background). Anchor build/test
  verification waits on it.
- Kamino Devnet program ID + SDK API pinned in Phase 2 from official docs.
- Open: Nimiq Pay mini-app Solana provider availability (runtime detection
  planned; fallback path TBD if EVM-only).
