"use client";

import { useState, type ReactNode } from "react";

// Shared shell for the combined 친구 tab (People | Chat segment control), the
// same arrangement /matching already uses for Meals | Rides. Both halves arrive
// already server-rendered from app/(tabs)/people/page.tsx; this only toggles
// which one is visible.
//
// People is the default half. It had no tab of its own before this and was
// reachable only through 홈's "Meet other participants" row, while chat has
// several other ways in: a notification lands on the thread itself, and every
// table and ride card links to its own chat.
export default function PeopleChatTabs({
  people,
  chat,
  unread,
  initialTab = "people",
}: {
  people: ReactNode;
  chat: ReactNode;
  unread: number;
  initialTab?: "people" | "chat";
}) {
  const [tab, setTab] = useState<"people" | "chat">(initialTab);

  return (
    <section style={{ padding: "24px 20px" }}>
      <header className="page-head">
        <h1 className="page-title">People &amp; Chat</h1>
        <p className="page-sub">Everyone who is here, and every conversation you are in.</p>
      </header>

      <div className="pc-seg" role="tablist" aria-label="People and chat">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "people"}
          className={tab === "people" ? "pc-seg__btn on" : "pc-seg__btn"}
          onClick={() => setTab("people")}
        >
          People
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "chat"}
          className={tab === "chat" ? "pc-seg__btn on" : "pc-seg__btn"}
          onClick={() => setTab("chat")}
        >
          Chat
          {/* Chat is no longer what the tab opens on, so the count has to be
              legible from the People half or an unread message is invisible
              until you go looking for it. */}
          {unread > 0 && (
            <span className="pc-seg__badge" aria-label={`${unread} unread`}>
              {unread}
            </span>
          )}
        </button>
      </div>

      <div style={{ marginTop: 20 }}>{tab === "people" ? people : chat}</div>

      <style>{`
        .pc-seg {
          display: flex;
          gap: 22px;
          border-bottom: 1px solid var(--line);
          margin-top: 20px;
        }
        .pc-seg__btn {
          display: flex;
          align-items: center;
          gap: 7px;
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
        .pc-seg__btn.on {
          color: var(--ink);
          box-shadow: inset 0 -2px 0 0 var(--accent);
        }
        .pc-seg__badge {
          min-width: 18px;
          padding: 2px 6px;
          border-radius: 999px;
          background: var(--accent);
          color: var(--accent-ink);
          font-family: var(--font-body), sans-serif;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.3;
        }
      `}</style>
    </section>
  );
}
