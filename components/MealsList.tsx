"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import JoinSheet from "./JoinSheet";
import GoingSheet from "./GoingSheet";
import { joinSlot, leaveSlot } from "@/app/actions/signups";

export type Slot = {
  id: string;
  title: string;
  starts_at: string;
  area: string;
  join_deadline: string;
};
export type Signup = { partySize: number; notes: string };

const fmtWhen = (timezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });

function whenLine(startsAt: string, area: string, timezone: string) {
  // "Wed, 7:00 PM" -> "Wed · 7:00 PM · ChampionsGate"
  return `${fmtWhen(timezone).format(new Date(startsAt)).replace(", ", " · ")} · ${area}`;
}

export default function MealsList({
  slots,
  counts: counts0,
  mine: mine0,
  myGroupBySlot = {},
  nowMs,
  isGuest = false,
  timezone = "America/New_York",
}: {
  slots: Slot[];
  counts: Record<string, number>;
  mine: Record<string, Signup>;
  myGroupBySlot?: Record<string, string>;
  nowMs: number;
  isGuest?: boolean;
  timezone?: string;
}) {
  const router = useRouter();
  const [mine, setMine] = useState(mine0);
  const [counts, setCounts] = useState(counts0);
  // Two separate sheets: `openId` is the lightweight "you're going" info view
  // (chat link / leave), `editId` is the join/edit form (new joins, or
  // "Change how many / notes" from the going sheet). Never both at once.
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  // Awaits the server before touching UI state (rather than optimistic-then-
  // revert) so JoinSheet can show a schedule-conflict warning and let the
  // caller retry with confirmed:true, instead of the sheet closing and then
  // un-closing on a bounce.
  async function handleJoin(
    slotId: string,
    partySize: number,
    notes: string,
    confirmed = false,
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await joinSlot(slotId, { partySize, notes, confirmed });
    if (res.ok) {
      const prevMine = mine[slotId];
      const prevCount = counts[slotId] ?? 0;
      const prevSize = prevMine?.partySize ?? 0;
      setMine((m) => ({ ...m, [slotId]: { partySize, notes } }));
      setCounts((c) => ({ ...c, [slotId]: prevCount - prevSize + partySize }));
      setEditId(null);
    } else if (res.error !== "schedule_conflict") {
      flashToast(res.error === "closed" ? "This one just closed." : "Couldn't save. Try again.");
    }
    return res;
  }

  async function handleLeave(slotId: string) {
    const prevMine = mine[slotId];
    const prevCount = counts[slotId] ?? 0;

    setMine((m) => ({ ...m, [slotId]: undefined as unknown as Signup }));
    setCounts((c) => ({ ...c, [slotId]: Math.max(0, prevCount - (prevMine?.partySize ?? 1)) }));
    setOpenId(null);
    setEditId(null);

    const res = await leaveSlot(slotId);
    if (!res.ok) {
      setMine((m) => ({ ...m, [slotId]: prevMine }));
      setCounts((c) => ({ ...c, [slotId]: prevCount }));
      flashToast("Couldn't leave. Try again.");
    }
  }

  const goingSlot = slots.find((s) => s.id === openId) ?? null;
  const activeSlot = slots.find((s) => s.id === editId) ?? null;

  return (
    <div>
      <div>
        {slots.map((slot) => {
          const count = counts[slot.id] ?? 0;
          const joined = !!mine[slot.id];
          const closed = new Date(slot.join_deadline).getTime() <= nowMs;

          return (
            <div key={slot.id} className="meal-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>
                  {slot.title}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4 }}>
                  {whenLine(slot.starts_at, slot.area, timezone)}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 3 }}>
                  {count === 0 ? "Be the first in" : `${count} ${count === 1 ? "person" : "people"} in`}
                </div>
              </div>

              {joined ? (
                <button
                  className="act act--in"
                  onClick={() => setOpenId(slot.id)}
                  aria-label={`You're in ${slot.title}. View details.`}
                >
                  Going
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </button>
              ) : closed ? (
                <span className="act act--closed">Closed</span>
              ) : (
                <button
                  className="act act--join"
                  data-slot-id={slot.id}
                  onClick={() => (isGuest ? router.push("/login") : setEditId(slot.id))}
                >
                  Join <span aria-hidden>▸</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {goingSlot && (
        <GoingSheet
          slot={goingSlot}
          groupId={myGroupBySlot[goingSlot.id]}
          onClose={() => setOpenId(null)}
          onEdit={() => {
            setOpenId(null);
            setEditId(goingSlot.id);
          }}
          onLeave={handleLeave}
          timezone={timezone}
        />
      )}

      {activeSlot && (
        <JoinSheet
          slot={activeSlot}
          joined={!!mine[activeSlot.id]}
          signup={mine[activeSlot.id]}
          closed={new Date(activeSlot.join_deadline).getTime() <= nowMs}
          onClose={() => setEditId(null)}
          onJoin={handleJoin}
          onLeave={handleLeave}
          timezone={timezone}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}

      <style>{`
        .meal-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 16px 0;
          border-bottom: 1px solid var(--line);
        }
        .meal-row:last-child { border-bottom: none; }
        .act {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-height: 44px;
          padding: 0 4px;
          background: none;
          border: none;
          font-size: 14px;
          font-weight: 700;
          white-space: nowrap;
        }
        .act--join { color: var(--accent); cursor: pointer; }
        .act--join span { display: inline-block; transition: transform 0.15s ease; }
        .act--join:hover span { transform: translateX(3px); }
        .act--in { color: var(--accent); cursor: pointer; }
        .act--closed { color: var(--ink-3); font-weight: 600; }
        .toast {
          position: fixed;
          left: 50%;
          bottom: calc(96px + env(safe-area-inset-bottom));
          transform: translateX(-50%);
          z-index: 60;
          background: var(--ink);
          color: var(--bg);
          font-size: 14px;
          padding: 10px 16px;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
          animation: toast-in 200ms ease-out;
        }
        @keyframes toast-in {
          from { opacity: 0; transform: translate(-50%, 8px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .act--join span { transition: none; }
          .toast { animation: none; }
        }
      `}</style>
    </div>
  );
}
