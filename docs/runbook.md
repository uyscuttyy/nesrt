# Runbook: TSLAx Vault (Devnet)

## Prerequisites
- Solana CLI + Anchor 0.30.1 (`avm use 0.30.1`)
- Admin keypair at `keypairs/nesrt-admin.json` (gitignored, never commit)
- Devnet SOL in the admin wallet (faucet or transfer)

## Environment (Phase 2, idempotent)
```bash
cd setup && ./node_modules/.bin/tsx setup_devnet.ts
```
State in `setup/output/devnet.json`. Re-runs skip completed steps.

## Build, deploy, test (Phases 3-6)
```bash
export ANCHOR_WALLET=$PWD/keypairs/nesrt-admin.json
anchor build
anchor deploy --provider.cluster devnet --provider.wallet $ANCHOR_WALLET
source .env
export TSLAX_MINT KAMINO_MARKET KAMINO_RESERVE KAMINO_CTOKEN_MINT KAMINO_SUPPLY_VAULT
anchor test --provider.cluster devnet --skip-build --skip-deploy
```

## Frontend (Phases 7-9)
```bash
cd app && npm run dev   # http://localhost:3000
```
After every `anchor build`, copy the fresh IDL over the stub:
```bash
cp target/idl/vault.json app/src/idl/vault.json
```

## Live addresses (Devnet)
- TSLAx mint: 4Dimn4s78herJKGhD3oxMMGbZcjirgwt376tdjq4HevA
- Kamino market: GjyuKPft2jBXy5aB32VWcWY5cc6jvAFcQozW6SkS7hSG
- Kamino reserve: 24EfeXj3XyLLE6GThh8ik4vcxEPMooAU5XXDL5nJHEr8
- cToken mint: 7zbpLvXSXipfgFn4XJeZWbw2F2nHaoAmMaJTPebiTpoU
- Vault program: DiUKSs93G6wBb5FZCjJ8NhknkaVDQht1yeeCTM8K8yPB
