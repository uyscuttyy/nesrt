import { Connection, PublicKey } from "@solana/web3.js";
import { VAULT_PROGRAM_ID } from "./config";

export type VaultEvent = {
  signature: string;
  slot: number;
  time: number | null;
  kind: "deposit" | "withdraw";
  tslax: number;
  shares: number;
};

// Current program logs (programs/vault/src/lib.rs):
//   "deposit: amount={} shares_minted={} ntsla_minted={}"
//   "withdraw: shares={} tslax_out={} principal={} yield={} treasury_fee={}"
const DEPOSIT_NEW = /deposit:\s*amount=(\d+)\s*shares_minted=(\d+)/;
const WITHDRAW_NEW = /withdraw:\s*shares=(\d+)\s*tslax_out=(\d+)/;
// Legacy fallbacks (old Kamino builds / tests):
const DEPOSIT_OLD = /deposit:\s*tslax=(\d+)\s*ctokens=(\d+)\s*ytslax=(\d+)/;
const WITHDRAW_OLD = /withdraw:\s*shares=(\d+)\s*tslax=(\d+)/;

/**
 * Real user history, two-tiered:
 * 1. Live Helius webhook store (same-origin `/api/webhooks/helius`, instant).
 * 2. RPC fallback: wallet signatures involving the vault program, decoded
 *    from on-chain log lines. No indexer key needed.
 * Results are merged, webhook-first, deduped by signature.
 */
export async function fetchVaultHistory(
  connection: Connection,
  owner: PublicKey,
  limit = 20
): Promise<VaultEvent[]> {
  const [live, chain] = await Promise.all([
    fetchWebhookHistory(owner, limit).catch(() => [] as VaultEvent[]),
    fetchRpcHistory(connection, owner, limit).catch(() => [] as VaultEvent[]),
  ]);
  const seen = new Set<string>();
  const out: VaultEvent[] = [];
  for (const e of [...live, ...chain]) {
    if (seen.has(e.signature)) continue;
    seen.add(e.signature);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** Same-origin webhook store. Empty until Helius delivers (or in SSR). */
async function fetchWebhookHistory(owner: PublicKey, limit: number): Promise<VaultEvent[]> {
  if (typeof window === "undefined") return [];
  const res = await fetch(
    `/api/webhooks/helius?owner=${owner.toBase58()}&limit=${limit}`
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { events?: VaultEvent[] };
  return Array.isArray(body.events) ? body.events : [];
}

async function fetchRpcHistory(
  connection: Connection,
  owner: PublicKey,
  limit = 20
): Promise<VaultEvent[]> {
  const programId = new PublicKey(VAULT_PROGRAM_ID);
  const sigs = await connection.getSignaturesForAddress(owner, { limit: 60 });
  const out: VaultEvent[] = [];
  for (const s of sigs) {
    if (out.length >= limit) break;
    if (s.err) continue;
    const tx = await connection
      .getTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
      .catch(() => null);
    if (!tx?.meta?.logMessages) continue;
    const touchesVault = (tx.transaction.message.staticAccountKeys ?? []).some((k) =>
      k.equals(programId)
    );
    if (!touchesVault) continue;
    for (const line of tx.meta.logMessages) {
      const dNew = line.match(DEPOSIT_NEW);
      if (dNew) {
        out.push({
          signature: s.signature,
          slot: s.slot,
          time: s.blockTime ?? null,
          kind: "deposit",
          tslax: Number(dNew[1]) / 1e6,
          shares: Number(dNew[2]) / 1e6,
        });
        break;
      }
      const dOld = line.match(DEPOSIT_OLD);
      if (dOld) {
        out.push({
          signature: s.signature,
          slot: s.slot,
          time: s.blockTime ?? null,
          kind: "deposit",
          tslax: Number(dOld[1]) / 1e6,
          shares: Number(dOld[3]) / 1e6,
        });
        break;
      }
      const wNew = line.match(WITHDRAW_NEW);
      if (wNew) {
        out.push({
          signature: s.signature,
          slot: s.slot,
          time: s.blockTime ?? null,
          kind: "withdraw",
          tslax: Number(wNew[2]) / 1e6,
          shares: Number(wNew[1]) / 1e6,
        });
        break;
      }
      const wOld = line.match(WITHDRAW_OLD);
      if (wOld) {
        out.push({
          signature: s.signature,
          slot: s.slot,
          time: s.blockTime ?? null,
          kind: "withdraw",
          tslax: Number(wOld[2]) / 1e6,
          shares: Number(wOld[1]) / 1e6,
        });
        break;
      }
    }
  }
  return out;
}
