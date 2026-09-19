import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";

export const dynamic = "force-dynamic";

const HERMES_URL = "https://hermes.pyth.network";
const DEFAULT_FEED_ID_HEX =
  "47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362";
const DEVNET_RECEIVER_ID = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJE";
const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

/**
 * Build a Hermes-posted TSLAx/USD update bundle for the caller's deposit/
 * withdraw transaction. Returns serialized post_update instructions plus the
 * ephemeral update-account signer (throwaway, unfunded) and the account the
 * vault must read as price_update.
 *
 * Auth: none hardcoded (plain Hermes REST, no bearer header). If Hermes
 * requires a key, set HERMES_HEADERS_JSON (e.g. '{"Authorization":"Bearer
 * <key>"}') — merged into the request.
 *
 * The receiver SDK is loaded at request time (never bundled: its transitive
 * rpc-websockets tree is unresolvable in this build env). If unavailable,
 * this route 502s cleanly and callers use the legacy path.
 */
export async function POST(req: Request) {
  try {
    const { feedIdHex, payer } = (await req.json().catch(() => ({}))) as {
      feedIdHex?: string;
      payer?: string;
    };
    if (!payer) return NextResponse.json({ error: "Missing payer." }, { status: 400 });
    const payerKey = new PublicKey(payer);
    const feedId = feedIdHex ?? DEFAULT_FEED_ID_HEX;

    let headers: Record<string, string> = {};
    try {
      if (process.env.HERMES_HEADERS_JSON) {
        headers = JSON.parse(process.env.HERMES_HEADERS_JSON) as Record<string, string>;
      }
    } catch {
      return NextResponse.json({ error: "Bad HERMES_HEADERS_JSON." }, { status: 500 });
    }
    const url =
      `${HERMES_URL}/v2/updates/price/latest?` +
      `ids[]=${encodeURIComponent(`0x${feedId}`)}&encoding=hex`;
    const res = await fetch(url, { headers });
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        { error: "Hermes update access requires an API key (HTTP 401). Set HERMES_HEADERS_JSON." },
        { status: 502 }
      );
    }
    if (!res.ok) throw new Error(`Hermes HTTP ${res.status}.`);
    const update = (await res.json()) as {
      binary?: { data?: string[] };
    };
    const vaaHex = update?.binary?.data?.[0];
    if (!vaaHex) throw new Error("Hermes returned no price update data.");

    // Request-time load: never bundled into the client or build graph.
    const pkg = "@pythnetwork/pyth-solana-receiver";
    let receiverMod: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      receiverMod = require(pkg);
    } catch {
      return NextResponse.json(
        { error: "Posting SDK unavailable in this environment (rpc-websockets tree unresolvable)." },
        { status: 502 }
      );
    }
    const { PythSolanaReceiver } = receiverMod as {
      PythSolanaReceiver: new (args: {
        connection: Connection;
        wallet: { publicKey: PublicKey };
        receiverProgramId: PublicKey;
      }) => {
        buildPostPriceUpdateInstructions: (vaas: string[]) => Promise<{
          postInstructions: {
            instruction: {
              programId: PublicKey;
              keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
              data: Buffer;
            };
            signers?: { publicKey: PublicKey; secretKey: Uint8Array }[];
          }[];
          priceFeedIdToPriceUpdateAccount: Record<string, PublicKey>;
        }>;
      };
    };
    const connection = new Connection(RPC_URL, "confirmed");
    const receiver = new PythSolanaReceiver({
      connection,
      wallet: { publicKey: payerKey },
      receiverProgramId: new PublicKey(DEVNET_RECEIVER_ID),
    });
    const { postInstructions, priceFeedIdToPriceUpdateAccount } =
      await receiver.buildPostPriceUpdateInstructions([vaaHex]);
    const priceUpdateAccount =
      priceFeedIdToPriceUpdateAccount[`0x${feedId}`] ??
      priceFeedIdToPriceUpdateAccount[Object.keys(priceFeedIdToPriceUpdateAccount)[0]];
    if (!priceUpdateAccount) throw new Error("No price update account derived.");

    const instructions = postInstructions.map((ix) => ({
      programId: ix.instruction.programId.toBase58(),
      keys: ix.instruction.keys.map((k) => ({
        pubkey: k.pubkey.toBase58(),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: Buffer.from(ix.instruction.data).toString("base64"),
      signers: (ix.signers ?? []).map((s) => Array.from(s.secretKey)),
    }));
    return NextResponse.json({
      priceUpdateAccount: priceUpdateAccount.toBase58(),
      instructions,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Price update failed.";
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 });
  }
}
