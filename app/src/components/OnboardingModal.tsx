"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

/**
 * First-run guardrail: explains this is a Devnet experience with mock
 * assets, and offers one-click SOL + TSLAx funding.
 */
export default function OnboardingModal({
  onFunded,
  onClose,
}: {
  onFunded: () => void;
  onClose: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function fund() {
    if (!publicKey) return;
    setBusy(true);
    setNote("");
    try {
      // SOL airdrop is best-effort: public devnet faucet is often rate-limited
      // (429). Most users already have SOL — never block TSLAx on it.
      try {
        const sig = await connection.requestAirdrop(publicKey, 1_000_000_000);
        await connection.confirmTransaction(sig, "confirmed").catch(() => null);
      } catch {
        /* ignore — continue to TSLAx mint */
      }
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: publicKey.toBase58() }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "TSLAx faucet failed.");
      onFunded();
      onClose();
    } catch (e) {
      setNote(e instanceof Error ? e.message.slice(0, 200) : "Funding failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Welcome to the Devnet vault</h2>
        <p className="muted">
          This is a Devnet experience. TSLAx is a mock asset with no value, and
          balances here are for testing only.
        </p>
        <div className="cta-row">
          <button className="cta" disabled={busy} onClick={() => void fund()}>
            {busy ? "Funding" : "Airdrop Devnet TSLAx and SOL"}
          </button>
          <button className="ghost" onClick={onClose}>
            Skip
          </button>
        </div>
        {note ? <p className="error">{note}</p> : null}
      </div>
    </div>
  );
}
