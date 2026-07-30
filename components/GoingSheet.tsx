"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { Slot } from "./MealsList";

const fmtWhen = (timezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });

// The "you're already in" view — deliberately lighter than JoinSheet's
// party-size/notes editor: just what you'd actually want to check ("am I
// still going, is there a chat yet, do I want out"), not the join form
// again. Editing party size/notes still lives behind "Change details",
// which hands off to JoinSheet in edit mode.
export default function GoingSheet({
  slot,
  groupId,
  onClose,
  onEdit,
  onLeave,
  timezone = "America/New_York",
}: {
  slot: Slot;
  groupId?: string;
  onClose: () => void;
  onEdit: () => void;
  onLeave: (slotId: string) => void;
  timezone?: string;
}) {
  const dtf = fmtWhen(timezone);
  const sheetRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Same dialog a11y as JoinSheet: focus in on open, restore on close,
  // Escape closes, Tab trapped inside.
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
    <div className="going-backdrop" onClick={onClose}>
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="going-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${slot.title} — you're going`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="going-grabber" aria-hidden="true" />

        <p className="going-kicker">You&apos;re in</p>
        <h2 className="going-title">{slot.title}</h2>
        <p className="going-sub">
          {dtf.format(new Date(slot.starts_at))} · {slot.area}
        </p>

        {groupId ? (
          <div className="going-note going-note--ready">
            <p className="going-note__text">Your table is set.</p>
          </div>
        ) : (
          <div className="going-note">
            <p className="going-note__text">
              Tables revealed {dtf.format(new Date(slot.join_deadline))}
            </p>
          </div>
        )}

        {groupId ? (
          <Link href={`/groups/${groupId}/chat`} className="going-btn-primary">
            Open group chat
          </Link>
        ) : (
          <button type="button" className="going-btn-primary" onClick={onClose}>
            Got it
          </button>
        )}

        <button type="button" className="going-textlink" onClick={onEdit}>
          Change how many / notes
        </button>
        <button
          type="button"
          className="going-btn-leave"
          onClick={() => {
            onLeave(slot.id);
            onClose();
          }}
        >
          Leave this dinner
        </button>
        <button type="button" className="going-btn-close" onClick={onClose}>
          Close
        </button>
      </div>

      <style>{`
        .going-backdrop {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: var(--overlay);
          display: flex;
          align-items: flex-end;
          animation: going-fade 200ms ease-out;
        }
        .going-sheet {
          width: 100%;
          background: var(--bg);
          border-radius: 16px 16px 0 0;
          padding: 8px 20px calc(20px + env(safe-area-inset-bottom));
          box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.5);
          animation: going-up 300ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .going-sheet:focus { outline: none; }
        .going-grabber {
          width: 36px; height: 5px; border-radius: 999px;
          background: var(--line); margin: 6px auto 16px;
        }
        .going-kicker {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.08em; color: var(--accent);
        }
        .going-title {
          font-family: var(--font-display), sans-serif;
          font-size: 24px; font-weight: 800; letter-spacing: -0.03em;
          margin: 4px 0 2px;
        }
        .going-sub { font-size: 14px; color: var(--ink-2); margin-bottom: 18px; }
        .going-note {
          margin-bottom: 16px;
          padding: 12px 14px;
          border-radius: 12px;
          background: color-mix(in srgb, var(--accent) 8%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
        }
        .going-note--ready { background: color-mix(in srgb, var(--accent) 14%, transparent); }
        .going-note__text { font-size: 13px; font-weight: 600; color: var(--accent); margin: 0; }
        .going-btn-primary {
          display: block;
          width: 100%;
          box-sizing: border-box;
          border: none;
          background: var(--accent-grad);
          color: var(--accent-ink);
          font-size: 16px;
          font-weight: 700;
          padding: 14px;
          border-radius: 12px;
          cursor: pointer;
          text-align: center;
          text-decoration: none;
        }
        .going-textlink {
          display: block;
          width: 100%;
          margin-top: 14px;
          background: none;
          border: none;
          padding: 8px 0;
          color: var(--accent);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          text-align: center;
        }
        .going-btn-leave {
          display: block;
          width: 100%;
          margin-top: 4px;
          border: none;
          background: transparent;
          color: var(--danger);
          font-size: 15px;
          font-weight: 500;
          padding: 12px;
          cursor: pointer;
        }
        .going-btn-close {
          display: block;
          width: 100%;
          margin-top: 4px;
          border: none;
          background: transparent;
          color: var(--ink-3);
          font-size: 15px;
          padding: 12px;
          cursor: pointer;
        }
        @keyframes going-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes going-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .going-sheet { animation: going-fade 200ms ease-out; }
        }
      `}</style>
    </div>
  );
}
