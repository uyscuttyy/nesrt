# TSLAx Yield Vault (Devnet MVP)

One-click, single-asset vault: deposit mock TSLAx, earn real Kamino Lend
Devnet yield, withdraw with accrued interest. Solana Devnet only.

## Structure

- `programs/vault/` — Anchor program (vault PDA, yTSLAx receipt mint, Kamino CPI)
- `setup/` — one-time Devnet environment script (TSLAx mint + Kamino market/reserve)
- `app/` — Next.js frontend (landing page + dashboard)
- `tests/` — Anchor integration tests
- `docs/` — prd.md, architecture.md, handoff.md

## Quickstart

```bash
npm install
cp .env.example .env   # fill in Devnet addresses after Phase 2
```

See `docs/handoff.md` for current status.
