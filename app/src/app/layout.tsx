import type { Metadata } from "next";
import Providers from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "TSLAx Vault — Wake up your sleeping capital",
  description:
    "One-click yield on tokenized TSLA. Deposit TSLAx, earn real Kamino lending yield on Solana Devnet.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
