"use client";

import { useEffect, useRef, useState } from "react";
import type { Slot, Signup } from "./MealsList";

const fmtWhen = (timezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });

const PARTY: { label: string; val: number }[] = [
  { label: "Just me", val: 1 },
  { label: "+1", val: 2 },
  { label: "+2", val: 3 },
  { label: "+3", val: 4 },
];

export default function JoinSheet({
  slot,
  joined,
  signup,
  closed,
  onClose,
  onJoin,
  onLeave,
  timezone = "America/New_York",
}: {
  slot: Slot;
  joined: boolean;
  signup?: Signup;
  closed: boolean;
  onClose: () => void;
  onJoin: (
    slotId: string,
    partySize: number,
    notes: string,
    confirmed?: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  onLeave: (slotId: string) => void;
  timezone?: string;
}) {
  const dtf = fmtWhen(timezone);
  const [partySize, setPartySize] = useState<number>(signup?.partySize ?? 1);
  const [notes, setNotes] = useState(signup?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [scheduleWarning, setScheduleWarning] = useState(false);

  async function handlePrimary() {
    setBusy(true);
    const res = await onJoin(slot.id, partySize, notes, scheduleWarning);
    setBusy(false);
    if (!res.ok && res.error === "schedule_conflict") setScheduleWarning(true);
  }

  const sheetRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Dialog controls (parity with Chat's roster sheet): focus moves in on open
  // and restores to the opener on close; Escape closes; Tab is trapped inside.
  useEffect(() => {
    openerRef.current = document.activeElement;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onCloseRef.current();
      if (e.key !== "Tab" || !sheetRef.current) return;
      const nodes = sheetRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const a = document.activeElement;
      if (e.shiftKey && (a === first || a === sheetRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && a === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Join ${slot.title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grabber" aria-hidden="true" />

        <p className="sheet-kicker">Dinner</p>
        <h2 className="sheet-title">{slot.title}</h2>
        <p className="sheet-sub">
          {dtf.format(new Date(slot.starts_at))} · {slot.area}
        </p>

        {closed ? (
          <p style={{ fontSize: 15, color: "var(--ink-2)", marginBottom: 8 }}>
            This one&apos;s closed.
          </p>
        ) : (
          <>
            <label className="field-label">How many are you, including yourself?</label>
            <div className="seg" role="group" aria-label="How many in your party">
              {PARTY.map((s) => {
                const selected = partySize === s.val;
                return (
                  <button
                    key={s.label}
                    type="button"
                    className={`seg__opt${selected ? " seg__opt--on" : ""}`}
                    aria-pressed={selected}
                    onClick={() => setPartySize(s.val)}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <p className="party-hint">
              {partySize > 1
                ? `We'll seat your group of ${partySize} together with another small group.`
                : "Come solo. We'll seat you with people worth meeting."}
            </p>

            <label className="field-label" htmlFor="join-notes" style={{ marginTop: 20 }}>
              Notes
            </label>
            <textarea
              id="join-notes"
              className="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything your table should know? (optional)"
            />

            <div className="reveal-note">
              <p className="reveal-when">Tables revealed {dtf.format(new Date(slot.join_deadline))}</p>
              <p className="reveal-sub">You&apos;ll know your table and plan before dinner.</p>
            </div>

            {scheduleWarning && (
              <div className="schedule-warn">
                <p className="schedule-warn__text">
                  You&apos;re leaving before this one — still join?
                </p>
              </div>
            )}

            <button className="btn-primary" onClick={handlePrimary} disabled={busy}>
              {busy
                ? "Saving…"
                : scheduleWarning
                  ? "Join anyway"
                  : joined
                    ? "Save changes"
                    : "Join"}
            </button>

            {joined && (
              <button className="btn-leave" onClick={() => onLeave(slot.id)}>
                Leave this dinner
              </button>
            )}
          </>
        )}

        <button className="btn-close" onClick={onClose}>
          Close
        </button>
      </div>

      <style>{`
        .sheet-backdrop {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: var(--overlay);
          display: flex;
          align-items: flex-end;
          animation: sheet-fade 200ms ease-out;
        }
        .sheet {
          width: 100%;
          background: var(--bg);
          border-radius: 16px 16px 0 0;
          padding: 8px 20px calc(20px + env(safe-area-inset-bottom));
          box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.5);
          animation: sheet-up 300ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .sheet:focus { outline: none; } /* focus scope, not an interactive control */
        .grabber {
          width: 36px;
          height: 5px;
          border-radius: 999px;
          background: var(--line);
          margin: 6px auto 16px;
        }
        /* Editorial masthead — matches Chat's roster sheet. */
        .sheet-kicker {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.08em; color: var(--accent);
        }
        .sheet-title {
          font-family: var(--font-display), sans-serif;
          font-size: 24px; font-weight: 800; letter-spacing: -0.03em;
          margin: 4px 0 2px;
        }
        .sheet-sub { font-size: 14px; color: var(--ink-2); margin-bottom: 22px; }
        .field-label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: var(--ink-2);
          margin-bottom: 10px;
        }
        /* Party size — hairline pills, not a grey segmented box. */
        .seg { display: flex; gap: 8px; }
        .seg__opt {
          flex: 1;
          min-height: 44px;
          border: 1px solid var(--line);
          background: transparent;
          color: var(--ink);
          font-size: 15px;
          font-weight: 600;
          border-radius: 999px;
          cursor: pointer;
          transition: border-color 150ms ease-out, background 150ms ease-out, color 150ms ease-out;
        }
        .seg__opt--on {
          border-color: var(--accent);
          background: var(--accent);
          color: var(--accent-ink);
        }
        .party-hint {
          font-size: 13px;
          color: var(--ink-2);
          margin: 10px 2px 0;
          line-height: 1.4;
        }
        /* De-boxed to a hairline underline, matching the onboarding fields. */
        .notes {
          width: 100%;
          box-sizing: border-box;
          font: inherit;
          font-size: 16px;
          color: var(--ink);
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--line);
          border-radius: 0;
          padding: 8px 2px;
          resize: none;
        }
        .notes::placeholder { color: var(--ink-3); }
        .notes:focus {
          outline: none;
          border-bottom-color: var(--accent);
        }
        .reveal-note {
          margin-top: 18px;
          padding: 12px 14px;
          border-radius: 12px;
          background: color-mix(in srgb, var(--accent) 8%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
        }
        .reveal-when { font-size: 13px; font-weight: 600; color: var(--accent); margin: 0; }
        .reveal-sub { font-size: 12px; color: var(--ink-2); margin: 4px 0 0; }
        .schedule-warn {
          margin-top: 12px;
          padding: 12px 14px;
          border-radius: 12px;
          background: color-mix(in srgb, var(--danger) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
        }
        .schedule-warn__text { font-size: 13px; font-weight: 600; color: var(--danger); margin: 0; }
        .btn-primary {
          width: 100%;
          margin-top: 24px;
          border: none;
          background: var(--accent-grad);
          color: var(--accent-ink);
          font-size: 16px;
          font-weight: 700;
          padding: 14px;
          border-radius: 12px;
          cursor: pointer;
          transition: opacity 150ms ease-out;
        }
        .btn-primary:active { opacity: 0.85; }
        .btn-leave {
          width: 100%;
          margin-top: 8px;
          border: none;
          background: transparent;
          color: var(--danger);
          font-size: 15px;
          font-weight: 500;
          padding: 12px;
          cursor: pointer;
        }
        .btn-close {
          width: 100%;
          margin-top: 8px;
          border: none;
          background: transparent;
          color: var(--ink-3);
          font-size: 15px;
          padding: 12px;
          cursor: pointer;
        }
        @keyframes sheet-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes sheet-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sheet { animation: sheet-fade 200ms ease-out; }
          .seg__opt, .btn-primary { transition: none; }
        }
      `}</style>
    </div>
  );
}
