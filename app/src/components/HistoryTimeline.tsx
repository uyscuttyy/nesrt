"use client";

import { VaultEvent } from "../history";

function shortSig(sig: string): string {
  return sig.length > 12 ? `${sig.slice(0, 4)}…${sig.slice(-4)}` : sig;
}

function fmtDate(t: number | null): string {
  return t ? new Date(t * 1000).toLocaleDateString() : "—";
}

function fmtTime(t: number | null): string {
  return t
    ? new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";
}

/** Transaction history as a real table: Action / Amount / Hash / Date / Time. */
export default function HistoryTimeline({
  events,
  compact,
}: {
  events: VaultEvent[];
  compact?: boolean;
}) {
  const shown = compact ? events.slice(0, 5) : events;
  if (shown.length === 0) {
    return (
      <div className="card" style={{ marginTop: "1rem" }}>
        <span className="label">Transaction history</span>
        <p className="muted">No vault transactions yet — they will appear here with explorer links.</p>
      </div>
    );
  }
  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <span className="label">Transaction history</span>
      <div className="table-scroll">
        <table className="history-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Amount</th>
              <th>Transaction hash</th>
              <th>Date</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.signature}>
                <td>
                  <span className="badge-ok">{e.kind === "deposit" ? "Vaulted" : "Unvaulted"}</span>
                </td>
                <td className="mono">{e.tslax.toFixed(6)} TSLAx</td>
                <td>
                  <a
                    className="fine tx-hash"
                    href={`https://explorer.solana.com/tx/${e.signature}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    title={e.signature}
                  >
                    {shortSig(e.signature)}
                  </a>
                </td>
                <td className="muted">{fmtDate(e.time ?? null)}</td>
                <td className="muted">{fmtTime(e.time ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
