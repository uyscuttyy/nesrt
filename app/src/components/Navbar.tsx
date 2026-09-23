"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import ThemeToggle from "@/components/ThemeToggle";

/** Persistent top navigation: Home / Vault / A&E / Pool + wallet + devnet. */
export default function Navbar() {
  const pathname = usePathname();
  const items = [
    { href: "/", label: "Home", exact: true },
    { href: "/app", label: "Vault", exact: true },
    { href: "/app/activity-earn", label: "A&E" },
    { href: "/app/pool", label: "Pool" },
  ];
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <div className="navbar-left">
          <Link className="brand" href="/">
            Nesrt
          </Link>
          <nav className="navbar-links" aria-label="Primary">
            {items.map((it) => {
              const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  className={active ? "nav-link nav-link-active" : "nav-link"}
                >
                  {it.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="navbar-right">
          <ThemeToggle />
          <ConnectWalletButton />
          <span className="badge">Devnet</span>
        </div>
      </div>
    </header>
  );
}
