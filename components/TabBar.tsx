"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string; icon: React.ReactNode };

// KakaoTalk-style IA: grouped by relationship (친구/채팅/매칭/마이페이지), not by
// feature (Home/Meals/Rides/People/Me). Icon-only — no .tabbar__label anymore.
// People is still reachable (Home's "Meet other participants" nudge links to it),
// it's just no longer a top-level tab.
const tabs: Tab[] = [
  {
    href: "/home",
    label: "친구",
    icon: (
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1.5a4 4 0 0 0-3-3.9M16 3.6a4 4 0 0 1 0 7.8" />
    ),
  },
  {
    href: "/chat",
    label: "채팅",
    icon: (
      <path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
    ),
  },
  {
    href: "/matching",
    label: "매칭",
    icon: (
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    ),
  },
  {
    href: "/me",
    label: "마이페이지",
    icon: <path d="M4 6h16M4 12h16M4 18h16" />,
  },
];

export default function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="tabbar" aria-label="Main navigation">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="tabbar__item"
            aria-current={active ? "page" : undefined}
            aria-label={tab.label}
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
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          border-top: 1px solid var(--glass-line);
        }
        .tabbar__item {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 14px 0 16px;
          text-decoration: none;
          transition: color 180ms ease-out;
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
        /* Desktop web layout: the same tab list, laid out as a left icon rail
           instead of a bottom bar — no forked component/logic, just a second
           CSS-driven arrangement. 마이페이지 (last item) gets pushed to the
           bottom via margin-top: auto, leaving room above it for
           NotificationBell (positioned separately, see app/globals.css). */
        @media (min-width: 1024px) {
          .tabbar {
            top: 0;
            bottom: 0;
            right: auto;
            width: 64px;
            flex-direction: column;
            justify-content: flex-start;
            padding: 20px 0;
            border-top: none;
            border-right: 1px solid var(--glass-line);
          }
          .tabbar__item {
            flex: 0 0 auto;
            padding: 14px 0;
          }
          .tabbar__item:last-child {
            margin-top: auto;
          }
        }
      `}</style>
    </nav>
  );
}
