# Handoff

## Status
- [x] Phase 1: Project init + git setup.
- [x] Phase 2: Devnet env live (mint, market, reserve Active, 100k seed).
  TSLAx 4Dimn4s78herJKGhD3oxMMGbZcjirgwt376tdjq4HevA, market
  GjyuKPft2jBXy5aB32VWcWY5cc6jvAFcQozW6SkS7hSG, reserve
  24EfeXj3XyLLE6GThh8ik4vcxEPMooAU5XXDL5nJHEr8, cToken
  7zbpLvXSXipfgFn4XJeZWbw2F2nHaoAmMaJTPebiTpoU. Exchange rate 1.0, APY 0
  (no borrows possible without an oracle; mechanics fully real).
- [x] Phase 3: Vault state + PDAs + 3-step init (initializeState /
  initializeMint / initCustody; split keeps each ix under the 4 KiB stack limit).
- [x] Phases 4-5: Deposit/withdraw with real Kamino CPI (supply +
  redeemReserveCollateral), yTSLAx minted 1:1 against cTokens received.
- [x] Phase 6: 6/6 integration tests green on devnet (tests5.log).
- [x] Phases 7-9: Frontend builds clean (wallet adapters, landing,
  dashboard, live reserve yield read).
- [ ] Phase 10: E2E polish + docs.

Program: DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB (devnet, upgradeable,
authority = admin J28vmQF8RPKnvcy1tZLxBAxmqxwYwvak56nMmfMGYLc3).

## Key findings (verified against klend program source)
- KLend devnet program = KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD (same as mainnet, verified executable on devnet).
- `init_reserve` takes no oracle config; config (incl. status Active) comes via update_reserve_config.
- `depositReserveLiquidity` / redeem refresh interest with price=None: vault flow never touches an oracle.
- Mock asset has no Scope/Pyth feed, so reserve is supply-only (LTV 0, borrows 0, placeholder Pyth key). Honest consequence: supply APY is 0 until a real feed + borrowers exist. cToken mechanics and exchange rate are fully real.
- kamino-manager CLI has no --devnet for add-asset-to-market, so setup_devnet.ts uses the SDK library directly.
- Kamino CPI gotchas fixed and verified: reserve + cToken mint must be
  writable (Kamino mutates both); vault authority PDA is signer-only
  (new_readonly + invoke_signed, never writable). KLend deposit/redeem
  discriminators a9c91e7e06cd6644 / redeem variant confirmed via real txs.
- anchor-cli 0.30.1 was built from source (otter-sec/anchor v0.30.1 tag,
  rust 1.79.0) into ~/.avm/bin; `anchor build` still unusable (pinned
  solana 1.18 toolchain vs edition2024 deps), so the program is built with
  solana 4.2.2 cargo-build-sbf and the IDL in target/idl + app/src/idl is
  hand-maintained (all discriminators sha256-verified, account
  discriminator fixed to [228,196,82,165,98,210,235,152]).
- `initialize_custody` as an ix name never dispatched on-chain (fallback
  101 for snake, PascalCase, and accounts variants while state/mint/deposit
  worked); renamed to `init_custody` and it works first try. Cause unknown,
  recorded here so nobody renames it back.

## Blockers / notes
- Open: Nimiq Pay mini-app Solana provider availability (runtime detection
  planned; fallback path TBD if EVM-only).
- Admin wallet spends SOL on every deploy (~1.6 per buffer, reclaimed via
  `solana program close` on stray buffers; program extend cost 0.14).
