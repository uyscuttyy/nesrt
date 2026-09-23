"use client";

import { VaultEvent } from "../history";

/** Shared transaction history: status badges + short hashes + explorer links. */
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
      <ul className="timeline">
        {shown.map((e) => (
          <li key={e.signature}>
            <span className="badge-ok">{e.kind === "deposit" ? "Vaulted" : "Unvaulted"}</span>{" "}
            <span className="muted">{e.tslax.toFixed(6)} TSLAx</span>{" "}
            <a
              className="fine tx-hash"
              href={`https://explorer.solana.com/tx/${e.signature}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              title={e.signature}
            >
              {e.signature.slice(0, 4)}…{e.signature.slice(-4)}
            </a>{" "}
            <span className="fine">
              {e.time ? new Date(e.time * 1000).toLocaleString() : `slot ${e.slot}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
