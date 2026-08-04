"use client";

import { useState } from "react";
import type { ScheduleDay } from "@/lib/schedule";

// day.date is already a plain conference-local date, so format it in UTC.
const wdFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const dayNumFmt = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" });
const fullFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export default function ScheduleDayView({
  days,
  initialIndex,
  todayDate,
  nowIso,
  timezone,
}: {
  days: ScheduleDay[];
  initialIndex: number;
  todayDate: string | null;
  nowIso: string;
  timezone: string;
}) {
  const [index, setIndex] = useState(Math.max(0, initialIndex));
  const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });
  const now = new Date(nowIso).getTime();

  if (days.length === 0) {
    return (
      <p style={{ fontSize: 15, color: "var(--ink-2)", margin: 0, paddingTop: 4 }}>
        The conference schedule hasn&apos;t been posted yet. Check back soon.
      </p>
    );
  }

  const day = days[index];
  const isToday = day.date === todayDate;

  return (
    <div>
      {/* A row of date chips rather than prev/next arrows: every day of the
          conference is visible at once, you can jump straight to one, and there
          is no hidden "which day am I on" state. Scrolls horizontally so a
          longer conference degrades instead of squashing. */}
      <div
        className="day-chips"
        role="tablist"
        aria-label="Conference days"
        // Arrow keys move between days and only the selected chip is a tab
        // stop, which is what a tablist promises once it claims the role.
        // Without it the agenda sat behind one tab press per day of the
        // conference, and the roles announced a set of tabs with nothing to
        // move into.
        onKeyDown={(e) => {
          const last = days.length - 1;
          const to =
            e.key === "ArrowRight" ? Math.min(last, index + 1)
            : e.key === "ArrowLeft" ? Math.max(0, index - 1)
            : e.key === "Home" ? 0
            : e.key === "End" ? last
            : null;
          if (to === null) return;
          e.preventDefault();
          setIndex(to);
          const chips = e.currentTarget.querySelectorAll<HTMLButtonElement>(".day-chip");
          chips[to]?.focus();
        }}
      >
        {days.map((d, i) => {
          const dt = new Date(`${d.date}T00:00:00Z`);
          const selected = i === index;
          return (
            <button
              key={d.date}
              type="button"
              role="tab"
              id={`day-tab-${d.date}`}
              aria-controls="day-panel"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              aria-label={`${fullFmt.format(dt)}${d.date === todayDate ? ", today" : ""}`}
              className="day-chip"
              onClick={() => setIndex(i)}
            >
              <span className="day-chip__wd">{wdFmt.format(dt)}</span>
              <span className="day-chip__d">{dayNumFmt.format(dt)}</span>
              {/* Always rendered so today's marker doesn't make one chip taller. */}
              <span
                className="day-chip__today"
                data-today={d.date === todayDate ? "true" : "false"}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      {/* No min-height here on purpose. Item counts across the week are
          genuinely uneven (2 items on the 4th, 13 on the 6th), and padding the
          light days out to match only buys an empty box: those days already fit
          in the viewport without scrolling, so the reserved space does nothing.
          The date chips above are what keep you oriented. */}
      <div
        className="sched-list"
        id="day-panel"
        role="tabpanel"
        aria-labelledby={`day-tab-${day.date}`}
      >
        {day.slots.map((slot) => {
          const current =
            isToday && now >= new Date(slot.starts_at).getTime() && now < new Date(slot.ends_at).getTime();
          return (
            <div
              key={`${slot.starts_at}|${slot.ends_at}`}
              className="sched-row"
              data-current={current ? "true" : "false"}
            >
              <div className="sched-time">{timeFmt.format(new Date(slot.starts_at))}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {slot.items.map((item) => (
                  <div key={item.id} className="sched-title" title={item.title}>
                    {item.title}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .day-chips {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          scrollbar-width: none;
          margin-bottom: 12px;
        }
        .day-chips::-webkit-scrollbar { display: none; }
        .day-chip {
          /* Grows to fill on a phone, where five chips land at a natural ~64px
             and the row reads as a full-width strip. The cap is what stops the
             same rule stretching each chip to ~120px in a 720px column, which
             is what made this screen look unlike the rest of the app: a date
             pill twice as wide as its own content. */
          flex: 1 0 auto;
          min-width: 48px;
          max-width: 72px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 2px 4px 4px;
          border: none;
          background: none;
          color: var(--ink-2);
          cursor: pointer;
        }
        .day-chip:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          border-radius: 10px;
        }
        .day-chip__wd {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        /* The selection marker is a disc behind the number, not a fill behind
           the whole chip. Painting the entire 56x62 cell made the date picker
           the loudest thing on a page whose actual subject is the agenda below
           it, louder than the title. Same signal, about a quarter of the ink,
           and it matches the hairline idiom the rest of the app uses. */
        .day-chip__d {
          display: grid;
          place-items: center;
          width: 32px;
          height: 32px;
          border-radius: 999px;
          font-size: 16px;
          font-weight: 700;
          color: var(--ink);
          font-variant-numeric: tabular-nums;
          transition: background 160ms ease-out, color 160ms ease-out;
        }
        .day-chip:hover:not([aria-selected="true"]) .day-chip__d {
          background: color-mix(in srgb, var(--ink) 10%, transparent);
        }
        .day-chip[aria-selected="true"] .day-chip__d {
          background: var(--accent);
          color: var(--accent-ink);
        }
        .day-chip__today {
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: transparent;
        }
        .day-chip__today[data-today="true"] { background: var(--accent); }

        /* Hairline-separated rows and no surrounding card, the same list idiom
           홈 already uses for "Line these up". An agenda is a list, and the
           border it had was drawing a box around something that reads better
           as a run of times. */
        .sched-list { border-bottom: 1px solid var(--line); }
        .sched-row {
          display: flex;
          gap: 14px;
          padding: 13px 2px;
          border-top: 1px solid var(--line);
        }
        /* Whatever is on right now. The tint is the state, and the accent time
           plus heavier title carry it without needing a container. */
        .sched-row[data-current="true"] {
          background: color-mix(in srgb, var(--accent) 9%, transparent);
          border-radius: 8px;
          padding-left: 10px;
          padding-right: 10px;
        }
        .sched-time {
          flex-shrink: 0;
          width: 78px;
          padding-top: 1px;
          font-size: 12.5px;
          color: var(--ink-2);
          /* Times line up column-wise instead of drifting with digit widths. */
          font-variant-numeric: tabular-nums;
        }
        .sched-row[data-current="true"] .sched-time {
          color: var(--accent);
          font-weight: 700;
        }
        .sched-row[data-current="true"] .sched-title { font-weight: 700; }

        /* Two lines then ellipsis. Every title in the current schedule fits
           inside two lines, so nothing is actually cut today. It caps the worst
           case, so one long title can't blow a row out to four lines and shift
           everything under it. Full text stays in the tooltip. */
        .sched-title {
          font-size: 14px;
          color: var(--ink);
          line-height: 1.4;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          overflow: hidden;
        }

        @media (prefers-reduced-motion: reduce) {
          .day-chip__d { transition: none; }
        }
      `}</style>
    </div>
  );
}
