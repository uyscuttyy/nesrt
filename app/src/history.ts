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

const DEPOSIT_RE = /deposit:\s*tslax=(\d+)\s*ctokens=(\d+)\s*ytslax=(\d+)/;
const WITHDRAW_RE = /withdraw:\s*shares=(\d+)\s*tslax=(\d+)/;

/**
 * Real user history: wallet signatures involving the vault program,
 * decoded from our own on-chain log lines. No indexer key needed.
 */
export async function fetchVaultHistory(
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
      const d = line.match(DEPOSIT_RE);
      if (d) {
        out.push({
          signature: s.signature,
          slot: s.slot,
          time: s.blockTime ?? null,
          kind: "deposit",
          tslax: Number(d[1]) / 1e6,
          shares: Number(d[3]) / 1e6,
        });
        break;
      }
      const w = line.match(WITHDRAW_RE);
      if (w) {
        out.push({
          signature: s.signature,
          slot: s.slot,
          time: s.blockTime ?? null,
          kind: "withdraw",
          tslax: Number(w[2]) / 1e6,
          shares: Number(w[1]) / 1e6,
        });
        break;
      }
    }
  }
  return out;
}
