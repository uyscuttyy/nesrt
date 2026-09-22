"use client";

/**
 * Cost-basis ledger for true profit display.
 * profit = current vaulted value + total withdrawn − total deposited.
 * Without this, deposits look like profit (the old chart bug).
 * Stored per wallet; first run baselines at the current position so
 * profit starts at 0 "since tracking started" instead of going negative.
 */

export type Flows = { inp: string; out: string; since: number };

const key = (owner: string) => `nesrt-flows-${owner}`;

export function loadFlows(owner: string): Flows | null {
  try {
    const raw = localStorage.getItem(key(owner));
    if (!raw) return null;
    const f = JSON.parse(raw) as Flows;
    if (typeof f.inp !== "string" || typeof f.out !== "string") return null;
    return f;
  } catch {
    return null;
  }
}

export function recordFlow(owner: string, dir: "in" | "out", amountBase: bigint): void {
  if (amountBase <= 0n) return;
  try {
    const prev = loadFlows(owner) ?? { inp: "0", out: "0", since: Date.now() };
    const next: Flows =
      dir === "in"
        ? { ...prev, inp: (BigInt(prev.inp) + amountBase).toString() }
        : { ...prev, out: (BigInt(prev.out) + amountBase).toString() };
    localStorage.setItem(key(owner), JSON.stringify(next));
  } catch {
    /* storage unavailable — profit falls back to position delta */
  }
}

/** First run with an existing position: baseline cost = current position. */
export function ensureBaseline(owner: string, positionBase: bigint): void {
  try {
    if (!localStorage.getItem(key(owner))) {
      localStorage.setItem(
        key(owner),
        JSON.stringify({ inp: positionBase.toString(), out: "0", since: Date.now() } as Flows)
      );
    }
  } catch {
    /* ignore */
  }
}

export function profitUi(
  positionUi: number | null,
  owner: string | null
): { profit: number | null; since: number | null } {
  if (positionUi === null || !owner) return { profit: null, since: null };
  const f = loadFlows(owner);
  if (!f) return { profit: 0, since: Date.now() };
  const profit =
    positionUi + Number(BigInt(f.out)) / 1e6 - Number(BigInt(f.inp)) / 1e6;
  return { profit, since: f.since };
}
