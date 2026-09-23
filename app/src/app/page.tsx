"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";

type PoolStats = {
  deposits: number;
  yieldAccrued: number;
  rate: number;
  apy: number;
} | null;

const faqs = [
  {
    q: "What does Pool yield actually mean?",
    a: "Lifetime yield sitting in the pool divided by total deposits — read live from the pool account on every refresh. It is not an annualized Wall Street APY, and it dilutes when big deposits land. The dashboard prints the exact division so you can check it.",
  },
  {
    q: "Is my principal at risk when I unvault?",
    a: "No. The 10% performance fee applies to yield only — principal is never skimmed. Unvaulting returns your share of deposits plus 90% of its yield.",
  },
  {
    q: "What is nTSLA?",
    a: "The liquid receipt for your vault position, minted 1:1 against pool shares. It stays in your wallet, earns while held, trades on Meteora for instant USDC, or burns back into TSLAx plus yield.",
  },
  {
    q: "Where does the yield come from?",
    a: "Lending-pool borrow interest, simulated on devnet by admin drips that raise the share price. Every drip, deposit, and skim is an on-chain transaction you can inspect.",
  },
  {
    q: "Is this real money?",
    a: "No. Devnet mock assets with no value. The mechanics — custody, CPI routing, fee math, oracle gating — are real.",
  },
];

const steps = [
  {
    n: "01",
    title: "Deposit TSLAx",
    body: "One transaction from your wallet. No pools to pick, no rates to compare, no positions to manage.",
  },
  {
    n: "02",
    title: "Automated CPI yield routing",
    body: "The vault program routes collateral into the lending pool on-chain, gates every flow on a live oracle price, and tracks your share.",
  },
  {
    n: "03",
    title: "Hold nTSLA",
    body: "Liquid receipt tokens minted 1:1 against pool shares. Earn while holding, trade on Meteora, unvault anytime.",
  },
];

export default function Landing() {
  const [stats, setStats] = useState<PoolStats>(null);

  useEffect(() => {
    (async () => {
      try {
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const rpc =
          process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
        const c = new Connection(rpc, "confirmed");
        const info = await c.getAccountInfo(
          new PublicKey("6TdFhCAHbod21bm7BCenz3fEAgfTQr1BGri7Mzjie9Nx")
        );
        if (!info) return;
        const d = Buffer.from(info.data);
        const o = 8 + 32 * 4;
        const dep = Number(d.readBigUInt64LE(o)) / 1e6;
        const y = Number(d.readBigUInt64LE(o + 16)) / 1e6;
        const sh = Number(d.readBigUInt64LE(o + 8)) / 1e6;
        if (dep <= 0 || sh <= 0) return;
        setStats({
          deposits: dep,
          yieldAccrued: y,
          rate: (dep + y) / sh,
          apy: (y / dep) * 100,
        });
      } catch {
        /* hero stats are best-effort */
      }
    })();
  }, []);

  return (
    <main>
      <Navbar />

      <section className="wrap hero">
        <p className="kicker">Tokenized equities, working</p>
        <h1>Unlock Native Yield on Tokenized Stocks.</h1>
        <p className="lede">
          Deposit TSLAx to earn automated lending yield (~8.5% APY). Receive liquid
          nTSLA receipt tokens to trade or unvault anytime.
        </p>
        <div className="cta-row">
          <Link className="cta" href="/app">
            Enter Vault
          </Link>
        </div>
        {stats ? (
          <p className="fine mono">
            live: {stats.deposits.toFixed(2)} vaulted · {stats.yieldAccrued.toFixed(4)} earned · {stats.apy.toFixed(2)}% pool yield
          </p>
        ) : (
          <p className="fine">Solana Devnet. Mock asset. Real on-chain mechanics.</p>
        )}
      </section>

      <section className="band">
        <div className="wrap">
          <h2>How it works</h2>
          <div className="steps">
            {steps.map((s) => (
              <div className="step card" key={s.n}>
                <span className="step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p className="muted">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap facts">
        <h2>Why vault instead of holding</h2>
        <div className="facts-list">
          <div className="card fact-row">
            <div>
              <h3>Idle capital earns nothing</h3>
              <p>TSLAx in a wallet is dead weight. Vaulted, the same tokens earn lending yield without you touching a reserve, a rate, or an LTV.</p>
            </div>
            <span className="fact-metric">0% → live yield</span>
          </div>
          <div className="card fact-row">
            <div>
              <h3>Receipts stay liquid</h3>
              <p>nTSLA is your position in token form: it accrues value, swaps on Meteora for instant USDC, or burns back into TSLAx plus yield.</p>
            </div>
            <span className="fact-metric">1 nTSLA ≡ pool shares</span>
          </div>
          <div className="card fact-row">
            <div>
              <h3>Every number is checkable</h3>
              <p>Pool totals, oracle prices, fee transfers, and history all live on-chain. The dashboard prints the math it uses — verify any of it.</p>
            </div>
            <span className="fact-metric">8/8 tests green</span>
          </div>
        </div>
        <div className="cta-row">
          <Link className="cta" href="/app">
            Enter Vault
          </Link>
        </div>
      </section>

      <section className="wrap facts">
        <h2>Questions, answered honestly</h2>
        <div className="facts-list">
          {faqs.map((f) => (
            <div className="card fact-row" key={f.q}>
              <div>
                <h3>{f.q}</h3>
                <p>{f.a}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="wrap footer">
        <p className="muted">
          Experimental software on Devnet. Mock assets, no value. Nothing here is an investment product.
        </p>
      </footer>
    </main>
  );
}
