import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * Simulated borrow-interest crank (devnet theater, honestly labeled).
 * Drips a small fixed amount of TSLAx into the mock pool, which raises the
 * share price — the same mechanism real borrow interest would drive.
 * Also refreshes the stub oracle when older than 12h, so the Pyth gate can
 * never go stale while anyone uses the app. Rate-limited server-side
 * (min interval); the dashboard calls it on a timer while open.
 */
const DRIP_BASE = 50_000n; // 0.05 TSLAx per crank
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const STUB_REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
const STUB_PRICE = 250_000_000n; // $250.00, expo -6
const STUB_EXPO = -6;
let lastDripAt = 0;

function adminKeypair(): Keypair {
  const raw = process.env.TSLAX_FAUCET_KEYPAIR;
  if (!raw) throw new Error("Crank is not configured on this deployment.");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

export async function POST() {
  try {
    const now = Date.now();
    if (now - lastDripAt < MIN_INTERVAL_MS) {
      return NextResponse.json({ skipped: true, reason: "rate-limited" });
    }
    const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
    const connection = new Connection(rpc, "confirmed");
    const admin = adminKeypair();
    const tslaxMint = new PublicKey(process.env.NEXT_PUBLIC_TSLAX_MINT ?? "");
    const pool = new PublicKey(process.env.NEXT_PUBLIC_MOCK_LENDER_POOL ?? "");
    const mockProgram = new PublicKey(process.env.NEXT_PUBLIC_MOCK_LENDER_PROGRAM_ID ?? "");
    const adminTslax = getAssociatedTokenAddressSync(tslaxMint, admin.publicKey);
    const poolVault = getAssociatedTokenAddressSync(tslaxMint, pool, true);

    const disc = crypto.createHash("sha256").update("global:drip_yield").digest().subarray(0, 8);
    const amt = Buffer.alloc(8);
    amt.writeBigUInt64LE(DRIP_BASE);
    const ix = new TransactionInstruction({
      programId: mockProgram,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: tslaxMint, isSigner: false, isWritable: false },
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: adminTslax, isSigner: false, isWritable: true },
        { pubkey: poolVault, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc, amt]),
    });
    const tx = new Transaction().add(ix);

    // Keep the stub oracle fresh: refresh when older than 12h (gate is 24h),
    // so deposits can never brick from staleness while the app is used.
    try {
      const vaultProgram = new PublicKey(process.env.NEXT_PUBLIC_VAULT_PROGRAM_ID ?? "");
      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault-v2"), tslaxMint.toBuffer()],
        vaultProgram
      );
      const [stub] = PublicKey.findProgramAddressSync(
        [Buffer.from("pyth-stub"), tslaxMint.toBuffer()],
        vaultProgram
      );
      const stubInfo = await connection.getAccountInfo(stub);
      let stale = true;
      if (stubInfo && stubInfo.data.length >= 61) {
        const pub = Number(Buffer.from(stubInfo.data).readBigInt64LE(52));
        stale = Date.now() / 1000 - pub > STUB_REFRESH_AFTER_MS / 1000;
      }
      if (stale) {
        const disc2 = crypto
          .createHash("sha256")
          .update("global:update_stub_price")
          .digest()
          .subarray(0, 8);
        const args = Buffer.alloc(12);
        args.writeBigInt64LE(STUB_PRICE, 0);
        args.writeInt32LE(STUB_EXPO, 8);
        tx.add(
          new TransactionInstruction({
            programId: vaultProgram,
            keys: [
              { pubkey: admin.publicKey, isSigner: true, isWritable: true },
              { pubkey: vaultState, isSigner: false, isWritable: false },
              { pubkey: tslaxMint, isSigner: false, isWritable: false },
              { pubkey: stub, isSigner: false, isWritable: true },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: Buffer.concat([disc2, args]),
          })
        );
      }
    } catch {
      /* stub refresh is best-effort; the drip below still runs */
    }

    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(admin);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    lastDripAt = Date.now();
    return NextResponse.json({ signature: sig, drippedBase: DRIP_BASE.toString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Crank failed.";
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 });
  }
}
