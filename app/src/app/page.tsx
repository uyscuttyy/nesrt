"use client";

import Link from "next/link";
import { KAMINO_RESERVE, TSLAX_MINT } from "../config";
import ThemeToggle from "@/components/ThemeToggle";

const steps = [
  {
    n: "01",
    title: "Deposit TSLAx",
    body: "One transaction. Your tokens move into the vault, no pools to pick, no rates to compare.",
  },
  {
    n: "02",
    title: "The vault supplies Kamino",
    body: "The program routes your TSLAx into a Kamino lending reserve on Solana Devnet and holds the interest-bearing cTokens.",
  },
  {
    n: "03",
    title: "Withdraw anytime",
    body: "Burn your receipt tokens and receive your TSLAx plus whatever the reserve earned. No lockups.",
  },
];

export default function Landing() {
  return (
    <main>
      <header className="wrap nav">
        <span className="brand">TSLAx Vault</span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <ThemeToggle />
          <span className="badge">Devnet MVP</span>
        </div>
      </header>

      <section className="wrap hero">
        <p className="kicker">Tokenized TSLA, at work</p>
        <h1>Wake up your sleeping capital.</h1>
        <p className="lede">
          Your TSLAx sits idle in your wallet. Deposit it once and earn real
          lending yield from Kamino, without managing positions, rates, or
          LTVs.
        </p>
        <div className="cta-row">
          <Link className="cta" href="/app">
            Enter the Vault
          </Link>
        </div>
        <p className="fine">Solana Devnet. Mock asset. Real on-chain mechanics.</p>
      </section>

      <section className="band">
        <div className="wrap">
          <h2>How it works</h2>
          <div className="steps">
            {steps.map((s) => (
              <div className="step" key={s.n}>
                <span className="step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p className="muted">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap facts">
        <h2>On-chain facts</h2>
        <dl>
          <div>
            <dt>TSLAx mint</dt>
            <dd className="mono">{TSLAX_MINT || "not configured"}</dd>
          </div>
          <div>
            <dt>Kamino reserve</dt>
            <dd className="mono">{KAMINO_RESERVE || "not configured"}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>Solana Devnet</dd>
          </div>
        </dl>
        <div className="cta-row">
          <Link className="cta" href="/app">
            Enter the Vault
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
