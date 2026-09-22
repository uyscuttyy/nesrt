"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Primary app navigation: one job per page, no mixed concerns. */
export default function AppNav() {
  const pathname = usePathname();
  const items = [
    { href: "/app", label: "Vault", exact: true },
    { href: "/app/earn", label: "Earn" },
    { href: "/app/activity", label: "Activity" },
    { href: "/app/pool", label: "Pool" },
  ];
  return (
    <nav className="tabs appnav" aria-label="App sections">
      {items.map((it) => {
        const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={active ? "tab tab-active" : "tab"}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
