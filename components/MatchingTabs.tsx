"use client";

import { useState, type ReactNode } from "react";

// Shared shell for the combined /matching tab (Meals | Rides segment control).
// `meals`/`rides` arrive already server-rendered (see app/(tabs)/matching/page.tsx)
// — this component only toggles which one is visible, no data fetching of its own.
export default function MatchingTabs({
  kicker,
  meals,
  rides,
}: {
  kicker: string;
  meals: ReactNode;
  rides: ReactNode;
}) {
  const [tab, setTab] = useState<"meals" | "rides">("meals");

  return (
    <section style={{ padding: "24px 20px" }}>
      <header className="page-head">
        <p className="page-kicker">{kicker}</p>
        <h1 className="page-title">Meals &amp; Rides</h1>
        <p className="page-sub">Grab dinner or split a ride with people worth meeting.</p>
      </header>

      <div className="matching-seg" role="tablist" aria-label="Matching section">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "meals"}
          className={tab === "meals" ? "matching-seg__btn on" : "matching-seg__btn"}
          onClick={() => setTab("meals")}
        >
          Meals
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "rides"}
          className={tab === "rides" ? "matching-seg__btn on" : "matching-seg__btn"}
          onClick={() => setTab("rides")}
        >
          Rides
        </button>
      </div>

      <div style={{ marginTop: 20 }}>{tab === "meals" ? meals : rides}</div>

      <style>{`
        .matching-seg {
          display: flex;
          gap: 22px;
          border-bottom: 1px solid var(--line);
          margin-top: 20px;
        }
        .matching-seg__btn {
          background: none;
          border: none;
          padding: 0 0 12px;
          cursor: pointer;
          font-family: var(--font-display), sans-serif;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--ink-3);
        }
        .matching-seg__btn.on {
          color: var(--ink);
          box-shadow: inset 0 -2px 0 0 var(--accent);
        }
      `}</style>
    </section>
  );
}
