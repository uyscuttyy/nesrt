/** Human-friendly translations of chain and wallet errors. Never show raw logs. */

const ANCHOR_CODES: Record<number, string> = {
  6000: "Enter an amount greater than zero.",
  6001: "Something went wrong with the math. Try a smaller amount.",
  6002: "The reserve did not issue funds for this deposit. Try again.",
  6003: "The reserve did not release funds for this withdrawal. Try again.",
  6004: "This app is pointed at the wrong lending market. Check your network.",
  6005: "This app is pointed at the wrong reserve. Check your network.",
  6006: "Token mismatch. Please refresh and try again.",
  6007: "Token mismatch. Please refresh and try again.",
  6008: "Connected to the wrong lending program. Check your network.",
  6009: "Market authority check failed. Please refresh and try again.",
  6010: "The vault is paused for safety. Withdrawals will reopen shortly.",
  6011: "You do not have enough vault shares for this withdrawal.",
  6012: "That amount is more than your vault position.",
  6013: "Your wallet is not the vault admin.",
};

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Transaction failed.";
  if (/user rejected|rejected the request|denied/i.test(msg)) {
    return "Transaction rejected in your wallet. Nothing moved.";
  }
  if (/insufficient funds|insufficient lamports|0x1\b/i.test(msg)) {
    return "Not enough SOL for fees. Use the faucet below to top up.";
  }
  if (/insufficient/i.test(msg)) {
    return "Insufficient balance for this action.";
  }
  if (/blockhash|expired|timeout/i.test(msg)) {
    return "The network was slow. Please try again.";
  }
  if (/not deployed|not configured/i.test(msg)) return msg;
  const codeMatch =
    msg.match(/Error Number:\s*(\d+)/) ?? msg.match(/custom program error:\s*0x([0-9a-f]+)/i);
  if (codeMatch) {
    const code = codeMatch[1].length > 4 ? parseInt(codeMatch[1], 16) : Number(codeMatch[1]);
    if (ANCHOR_CODES[code]) return ANCHOR_CODES[code];
  }
  for (const code of Object.keys(ANCHOR_CODES)) {
    if (msg.includes(` ${code}.`) || msg.endsWith(code)) return ANCHOR_CODES[Number(code)];
  }
  const short = msg.replace(/^(Error|Transaction|Simulation failed)[:.\s]*/i, "").trim();
  return short.length > 200 ? `${short.slice(0, 200)}...` : short || "Transaction failed. Please try again.";
}
