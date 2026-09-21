# Runbook: Nesrt Vault (Devnet)

## Prerequisites
- Solana CLI + cargo-build-sbf via solana 4.2.2 release (`stable-e29e5d9...`)
- Admin keypair at `keypairs/nesrt-admin.json` (gitignored, never commit)
- Devnet SOL in the admin wallet (faucet or transfer)
- Node 18+ for frontend/scripts

## Build programs (source of truth — `anchor build` is broken on edition2024)
```bash
export PATH="$HOME/.local/share/solana/install/releases/stable-e29e5d910f0c2b7176f58174e592e8488099ef75/solana-release/bin:$PATH"
cargo build-sbf --manifest-path programs/mock_lender/Cargo.toml
cargo build-sbf --manifest-path programs/vault/Cargo.toml
# outputs: target/deploy/mock_lender.so, target/deploy/vault.so
```

## Deploy / upgrade (devnet)
```bash
# Fresh program (mock v2 pattern):
solana program deploy target/deploy/mock_lender.so --url devnet \
  --keypair keypairs/nesrt-admin.json --program-id keypairs/mock-lender-v2.json \
  --upgrade-authority keypairs/nesrt-admin.json
# Upgrade vault (extend first if the binary grew past capacity):
solana program extend DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB 32768 --url devnet --keypair keypairs/nesrt-admin.json
solana program write-buffer target/deploy/vault.so --url devnet --keypair keypairs/nesrt-admin.json
solana program upgrade <BUFFER> DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB --url devnet --keypair keypairs/nesrt-admin.json
# Reclaim stale buffers afterwards:
solana program show --buffers --url devnet --keypair keypairs/nesrt-admin.json
solana program close <BUFFER> --url devnet --keypair keypairs/nesrt-admin.json
```

## Initialize (after fresh deploys)
```bash
npx tsx scripts/init-mock-lender-pool.ts   # pool PDA + vault ATA + shares mint
npx tsx scripts/create-custody-atas.ts     # vault TSLAx/shares ATAs
# treasury + pool config via Anchor ixs (see scripts/init-vault-state.ts pattern):
# init_treasury, update_mock_pool, update_stub_price (price 250_000_000, expo -6)
```

## Test (via ts-mocha directly, 8 tests)
```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=$PWD/keypairs/nesrt-admin.json
./node_modules/.bin/ts-mocha -p tsconfig.json -t 1000000 tests/vault.ts
```

## Frontend
```bash
cd app && npm install && npm run dev   # http://localhost:3000
npm run build  # must pass; tsc --noEmit must be clean
```
Env: copy `app/.env.example` → `app/.env.local`. Server-only keys (`TSLAX_FAUCET_KEYPAIR`,
`HELIUS_WEBHOOK_SECRET`, `HERMES_HEADERS_JSON`) never get `NEXT_PUBLIC_` prefix.

## Live addresses (Devnet, verified)
- TSLAx mint: 4Dimn4s78herJKGhD3oxMMGbZcjirgwt376tdjq4HevA
- Vault program: DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB
- Mock lender v2: 7fssoWBo1sjse4es9moMpMZm6Hpa9Kzb7U5KXXpYpp4g
- Mock pool: 6TdFhCAHbod21bm7BCenz3fEAgfTQr1BGri7Mzjie9Nx
- Shares mint: 6s2qM9MbCgcZzfdEmYt9PnvoYLpuF91PGCZ3T5noquAg
- Receipt (nTSLA) mint: AMXCrrSXNASso6ANoFsk2zAPUKimGvcCagVfx4Ev5hRA
- Treasury PDA: CEHuKwAgZp4aaynTo1oivCYT7nRGnWVRW9kSGd5MLmM4
- Pyth stub PDA: 2cXuUBQRjeDTJMCXVrq17VrS36spJcyXhxP6AE3HfKoZ
- Meteora LB pair (nTSLA/USDC): 3iCpUt4RPQ2gzjAN55w3tuar1Qa4YaH4qqD3LZxJtfUM
- Devnet USDC (Circle): 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
