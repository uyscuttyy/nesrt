"use client";

import Link from "next/link";
import Navbar from "@/components/Navbar";

const steps = [
  {
    title: "Deposit TSLAx",
    body: "One transaction from your wallet. No pools to pick, no rates to compare, no positions to manage.",
  },
  {
    title: "Automated CPI Yield Routing",
    body: "The vault program routes collateral into the lending pool on-chain and prices every share against a live oracle gate.",
  },
  {
    title: "Hold nTSLA",
    body: "Liquid receipt tokens minted 1:1 against pool shares. Earn while holding, trade on Meteora, unvault anytime.",
  },
];

const facts = [
  {
    title: "100% Backed Collateral",
    body: "Every nTSLA is a claim on vaulted TSLAx plus accrued yield. Yield is generated without liquidating your underlying price exposure.",
    metric: "1 nTSLA ≡ pool shares",
  },
  {
    title: "Real-Time On-Chain Verification",
    body: "Pyth stub oracles and Anchor program state update live. Every deposit, drip, and withdrawal is checkable on the explorer.",
    metric: "8/8 tests green",
  },
  {
    title: "Secondary Market Liquidity",
    body: "Exit without unvaulting: swap nTSLA for USDC instantly on the Meteora DLMM pool, then re-enter whenever you like.",
    metric: "0.25% fee · bin 25",
  },
];

export default function Landing() {
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
        <p className="fine">Solana Devnet. Mock asset. Real on-chain mechanics.</p>
      </section>

      <section className="band">
        <div className="wrap">
          <h2>How it works</h2>
          <div className="steps">
            {steps.map((s) => (
              <div className="step card" key={s.title}>
                <h3>{s.title}</h3>
                <p className="muted">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap facts">
        <h2>On-chain facts</h2>
        <div className="facts-list">
          {facts.map((f) => (
            <div className="card fact-row" key={f.title}>
              <div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
              <span className="fact-metric">{f.metric}</span>
            </div>
          ))}
        </div>
        <div className="cta-row">
          <Link className="cta" href="/app">
            Enter Vault
          </Link>
        </div>
      </section>

      <footer className="wrap footer">
        <p className="muted">
          Experimental software on Devnet. Nothing here is an investment product.
        </p>
      </footer>
    </main>
  );
}
