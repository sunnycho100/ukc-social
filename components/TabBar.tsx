"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string; icon: React.ReactNode };

const tabs: Tab[] = [
  {
    href: "/home",
    label: "Home",
    icon: (
      <path d="M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9" />
    ),
  },
  {
    href: "/meals",
    label: "Meals",
    icon: (
      <path d="M6 3v7a2 2 0 0 0 2 2v9M6 3v5m3-5v5m9-5c-1.5 1-2.5 3-2.5 6.5V12h2.5m0-9v18" />
    ),
  },
  {
    href: "/rides",
    label: "Rides",
    icon: (
      <path d="M5 16v3H3v-6l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v6h-2v-3H5m1.5-3.5h11M7 16h.5m9-.5h.5" />
    ),
  },
  {
    href: "/people",
    label: "People",
    icon: (
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1.5a4 4 0 0 0-3-3.9M16 3.6a4 4 0 0 1 0 7.8" />
    ),
  },
  {
    href: "/me",
    label: "Me",
    icon: (
      <path d="M20 21v-2a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
    ),
  },
];

export default function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="tabbar__item"
            aria-current={active ? "page" : undefined}
            style={{ color: active ? "var(--accent)" : "var(--ink-3)" }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {tab.icon}
            </svg>
            <span className="tabbar__label">{tab.label}</span>
          </Link>
        );
      })}

      <style>{`
        .tabbar {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 50;
          display: flex;
          justify-content: space-around;
          padding-bottom: env(safe-area-inset-bottom);
          background: var(--glass);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid var(--glass-line);
        }
        .tabbar__item {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 8px 0 9px;
          text-decoration: none;
          transition: color 180ms ease-out;
        }
        /* Bar is flush to the viewport edge — pull the ring inside so it isn't clipped. */
        .tabbar__item:focus-visible { outline-offset: -2px; }
        .tabbar__label {
          font-size: 11px;
          line-height: 1.15;
          letter-spacing: -0.01em;
        }
        @media (prefers-reduced-transparency: reduce) {
          .tabbar {
            background: var(--glass-solid);
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .tabbar__item {
            transition: none;
          }
        }
      `}</style>
    </nav>
  );
}
