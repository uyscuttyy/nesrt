import Link from "next/link";

export default function Landing() {
  return (
    <main className="wrap" style={{ paddingTop: "6rem", paddingBottom: "6rem" }}>
      <p className="muted" style={{ letterSpacing: "0.2em", fontSize: "0.8rem" }}>
        TSLAX VAULT
      </p>
      <h1 style={{ fontSize: "3.5rem", lineHeight: 1.05, margin: "1rem 0" }}>
        Wake up your sleeping capital.
      </h1>
      <p className="muted" style={{ fontSize: "1.2rem", maxWidth: "36rem" }}>
        Your tokenized TSLA sits idle. Deposit it once and earn real lending
        yield from Kamino, without managing positions, rates, or LTVs.
      </p>
      <div style={{ marginTop: "2.5rem" }}>
        <Link className="cta" href="/app">
          Enter the Vault
        </Link>
      </div>
      {/* Full product UI lands in Phases 7-9. */}
    </main>
  );
}
