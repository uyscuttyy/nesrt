import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type StoredEvent = {
  signature: string;
  slot: number;
  time: number | null;
  kind: "deposit" | "withdraw";
  tslax: number;
  shares: number;
  owner: string | null;
};

// In-memory ring buffer (dev/single-instance). For production, persist to KV/DB.
const MAX_EVENTS = 200;
const store: StoredEvent[] = [];

const VAULT_PROGRAM_ID = process.env.NEXT_PUBLIC_VAULT_PROGRAM_ID ?? "";
const TSLAX_MINT = process.env.NEXT_PUBLIC_TSLAX_MINT ?? "";

const DEPOSIT_NEW = /deposit:\s*amount=(\d+)\s*shares_minted=(\d+)/;
const WITHDRAW_NEW = /withdraw:\s*shares=(\d+)\s*tslax_out=(\d+)/;
const DEPOSIT_OLD = /deposit:\s*tslax=(\d+)\s*ctokens=(\d+)\s*ytslax=(\d+)/;
const WITHDRAW_OLD = /withdraw:\s*shares=(\d+)\s*tslax=(\d+)/;

type HeliusTx = {
  signature?: string;
  slot?: number;
  timestamp?: number;
  blockTime?: number;
  type?: string;
  description?: string;
  feePayer?: string;
  accountData?: { account?: string }[];
  tokenTransfers?: {
    fromUserAccount?: string;
    toUserAccount?: string;
    mint?: string;
    tokenAmount?: number;
  }[];
  meta?: { logMessages?: string[] };
  logMessages?: string[];
};

function pushEvent(e: StoredEvent) {
  if (store.some((s) => s.signature === e.signature)) return;
  store.unshift(e);
  if (store.length > MAX_EVENTS) store.length = MAX_EVENTS;
}

function parseTx(tx: HeliusTx): StoredEvent | null {
  const signature = tx.signature;
  if (!signature) return null;
  const accounts = (tx.accountData ?? []).map((a) => a?.account).filter(Boolean) as string[];
  const touchesVault =
    !!VAULT_PROGRAM_ID &&
    (accounts.includes(VAULT_PROGRAM_ID) ||
      JSON.stringify(tx).includes(VAULT_PROGRAM_ID));
  if (!touchesVault) return null;
  if ((tx as { transactionError?: unknown }).transactionError) return null;

  const logs = [...(tx.meta?.logMessages ?? []), ...(tx.logMessages ?? [])];
  const owner =
    tx.feePayer ??
    (tx.tokenTransfers?.[0]?.fromUserAccount as string | undefined) ??
    null;
  const time = tx.timestamp ?? tx.blockTime ?? null;
  const slot = tx.slot ?? 0;

  for (const line of logs) {
    const d = line.match(DEPOSIT_NEW) ?? line.match(DEPOSIT_OLD);
    if (d) {
      const tslax = Number(d[1]) / 1e6;
      const shares = Number(d[d.length - 1]) / 1e6;
      return { signature, slot, time, kind: "deposit", tslax, shares, owner };
    }
    const w = line.match(WITHDRAW_NEW) ?? line.match(WITHDRAW_OLD);
    if (w) {
      const shares = Number(w[1]) / 1e6;
      const tslax = Number(w[w.length - 1]) / 1e6;
      return { signature, slot, time, kind: "withdraw", tslax, shares, owner };
    }
  }

  // Fallback: infer direction from TSLAx token transfers when logs are absent.
  if (TSLAX_MINT) {
    for (const t of tx.tokenTransfers ?? []) {
      if (t.mint !== TSLAX_MINT || !t.tokenAmount) continue;
      const kind =
        /deposit|vault|stake/i.test(tx.description ?? "") ||
        /deposit/i.test(tx.type ?? "")
          ? "deposit"
          : /withdraw|unvault|unstake/i.test(`${tx.description ?? ""} ${tx.type ?? ""}`)
            ? "withdraw"
            : null;
      if (!kind) continue;
      return {
        signature,
        slot,
        time,
        kind,
        tslax: t.tokenAmount,
        shares: t.tokenAmount,
        owner,
      };
    }
  }
  return null;
}

/** Helius Enhanced webhook receiver (type: ENHANCED). */
export async function POST(req: Request) {
  try {
    // Optional shared secret: set HELIUS_WEBHOOK_SECRET and configure the
    // same value in the Helius dashboard (sent as `authorization: Bearer …`
    // or `?auth=`). Unset = accept with a warning (dev only).
    const secret = process.env.HELIUS_WEBHOOK_SECRET ?? "";
    if (secret) {
      const url = new URL(req.url);
      const header = req.headers.get("authorization") ?? "";
      const ok = header === `Bearer ${secret}` || url.searchParams.get("auth") === secret;
      if (!ok) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    } else {
      console.warn("[helius] no HELIUS_WEBHOOK_SECRET set — accepting unsigned (dev only).");
    }
    const body = (await req.json()) as unknown;
    const txs = (Array.isArray(body) ? body : [body]) as HeliusTx[];
    let stored = 0;
    for (const tx of txs) {
      const e = parseTx(tx);
      if (e) {
        pushEvent(e);
        stored++;
        console.log(`[helius] vault ${e.kind} ${e.signature} tslax=${e.tslax}`);
      }
    }
    return NextResponse.json({ stored, total: store.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Webhook failed.";
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 });
  }
}

/** Local event feed consumed by the dashboard (same-origin, no key needed). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const owner = url.searchParams.get("owner");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 100);
  const events = (owner ? store.filter((e) => e.owner === owner) : store).slice(0, limit);
  return NextResponse.json({ events });
}
