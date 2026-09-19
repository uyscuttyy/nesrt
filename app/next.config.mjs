/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Pyth SDKs pull node-only subpaths (rpc-websockets) that webpack can't
    // resolve; require them at runtime instead (API routes only, never client).
    serverComponentsExternalPackages: [
      "@pythnetwork/pyth-solana-receiver",
      "@pythnetwork/hermes-client",
    ],
  },
};
export default nextConfig;
