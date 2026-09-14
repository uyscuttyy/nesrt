/**
 * Sanctuary dashboard.
 * Wallet connection (Phase 7), deposit/withdraw (Phase 8),
 * and live Kamino yield tracking (Phase 9) plug in here.
 */
export default function Dashboard() {
  return (
    <main className="wrap" style={{ paddingTop: "4rem", paddingBottom: "4rem" }}>
      <h1 style={{ fontSize: "2rem" }}>The Sanctuary</h1>
      <p className="muted">
        Connect a Devnet wallet to deposit TSLAx and watch yield accrue.
      </p>
      <p className="muted" style={{ marginTop: "2rem" }}>
        Dashboard UI arrives in Phase 7. Contract integration in Phase 8. Live
        yield in Phase 9.
      </p>
    </main>
  );
}
