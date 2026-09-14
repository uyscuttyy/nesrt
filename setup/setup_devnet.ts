/**
 * Phase 2: Devnet environment bootstrap.
 *
 * One-time script. Will:
 *  1. Create the mock TSLAx SPL mint.
 *  2. Mint initial supply to the admin wallet.
 *  3. Create a Kamino lending market (devnet, KLend program).
 *  4. Initialize a TSLAx reserve and deposit admin seed liquidity.
 *  5. Print all addresses for Anchor.toml / .env.
 *
 * NOT YET IMPLEMENTED — writing and execution happen in Phase 2,
 * once the Rust/Solana/Anchor toolchain install completes.
 */
async function main(): Promise<void> {
  throw new Error("Phase 2: setup_devnet not implemented yet");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
