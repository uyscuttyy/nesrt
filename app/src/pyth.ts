import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

/** Public Hermes endpoint. No Authorization header (per integration spec). */
export const HERMES_URL = "https://hermes.pyth.network";
/** TSLAx/USD (xStocks spot, 24/7) — matches the vaulted collateral. */
export const TSLAX_FEED_ID_HEX =
  "47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362";
/** Pyth pull receiver on devnet (distinct from mainnet program id). */
export const DEVNET_RECEIVER_ID = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJE";

export type PostedUpdate = {
  /** PriceUpdateV2 account the posted update lands in (= vault price_update). */
  priceUpdateAccount: PublicKey;
  /** Instructions to prepend (post_update), in order. */
  postInstructions: TransactionInstruction[];
  /** Ephemeral signers that must co-sign (the update account keypair). */
  ephemeralSigners: Keypair[];
};

type PostBundle = {
  priceUpdateAccount: string;
  instructions: {
    programId: string;
    keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
    data: string;
    signers: number[][];
  }[];
  error?: string;
};

/**
 * Ask our server route to fetch the latest signed TSLAx/USD VAA from Hermes
 * and build the post_update instructions. The heavy Pyth SDKs stay
 * server-side (they don't bundle for the browser). Times out fast so a
 * dead Hermes never hangs a deposit — callers fall back to the stub path.
 */
export async function fetchAndBuildPriceUpdate(
  payer: PublicKey,
  timeoutMs = 5000
): Promise<PostedUpdate> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("/api/pyth/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payer: payer.toBase58() }),
      signal: ctrl.signal,
    });
    const body = (await res.json()) as PostBundle;
    if (!res.ok) throw new Error(body.error ?? "Price update unavailable.");
  return {
    priceUpdateAccount: new PublicKey(body.priceUpdateAccount),
    postInstructions: body.instructions.map(
      (ix) =>
        new TransactionInstruction({
          programId: new PublicKey(ix.programId),
          keys: ix.keys.map((k) => ({
            pubkey: new PublicKey(k.pubkey),
            isSigner: k.isSigner,
            isWritable: k.isWritable,
          })),
          data: Buffer.from(ix.data, "base64"),
        })
    ),
    ephemeralSigners: body.instructions.flatMap((ix) =>
      ix.signers.map((s) => Keypair.fromSecretKey(Uint8Array.from(s)))
    ),
  };
} catch (e) {
  clearTimeout(timer);
  throw e;
} finally {
  clearTimeout(timer);
}
}
