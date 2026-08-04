"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toLocalInput } from "@/lib/rides";
import type { Conference } from "@/lib/conference";
import FlightScanButton from "@/components/FlightScanButton";

type Slot = { id: string; title: string; starts_at: string };
export type Flight = { arrival: string; departure: string };

function whenLabel(iso: string, timezone: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

export default function StepPlans({
  value,
  onChange,
  flight,
  onFlightChange,
  onFinish,
  onBack,
  busy,
  error,
  conference,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  flight: Flight;
  onFlightChange: (f: Flight) => void;
  onFinish: () => void;
  onBack: () => void;
  busy: boolean;
  error: string;
  conference: Conference | null;
}) {
  const timezone = conference?.timezone ?? "America/New_York";
  // Conference dates as a starting point — picking a datetime-local value from
  // completely blank means setting year/month/day/hour/minute one at a time,
  // which is exactly the friction this sidesteps. Still fully editable.
  const defaultArrival = conference
    ? `${toLocalInput(conference.starts_at, timezone).slice(0, 10)}T12:00`
    : "";
  const defaultDeparture = conference
    ? `${toLocalInput(conference.ends_at, timezone).slice(0, 10)}T12:00`
    : "";
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [showFlight, setShowFlight] = useState(!!(flight.arrival || flight.departure));

  useEffect(() => {
    createClient()
      .from("slots")
      .select("id,title,starts_at")
      .eq("kind", "meal")
      // Only dinners you can still join. A closed one was offered like any
      // other, and signing up for it during onboarding put you in a dinner
      // whose tables had already been seated and shown.
      .gt("join_deadline", new Date().toISOString())
      .order("starts_at")
      .then(({ data }) => setSlots((data as Slot[]) ?? []));
  }, []);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <>
      <span className="ob-kicker">Set up · 5 of 5</span>
      <h1 className="ob-title">Which dinners are you in for?</h1>
      <p className="ob-sub">Pick any. We&apos;ll seat you with people worth meeting.</p>

      <div style={{ marginTop: 20 }}>
        {slots === null ? (
          <p style={{ color: "var(--ink-2)", fontSize: 14 }}>Loading…</p>
        ) : slots.length === 0 ? (
          <p style={{ color: "var(--ink-2)", fontSize: 14, paddingTop: 8 }}>
            Dinner slots open soon.
          </p>
        ) : (
          slots.map((s) => {
            const on = value.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={on ? "ob-slot on" : "ob-slot"}
                onClick={() => toggle(s.id)}
                aria-pressed={on}
              >
                <span aria-hidden className="ob-check">
                  {on ? "✓" : ""}
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontWeight: 600 }}>{s.title}</span>
                  <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                    {whenLabel(s.starts_at, timezone)}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      <div style={{ marginTop: 22 }}>
        <button
          type="button"
          className="ob-textlink"
          onClick={() => {
            setShowFlight((v) => {
              const opening = !v;
              if (opening && !flight.arrival && !flight.departure && defaultArrival) {
                onFlightChange({ arrival: defaultArrival, departure: defaultDeparture });
              }
              return opening;
            });
          }}
          aria-expanded={showFlight}
        >
          {showFlight ? "− Flying in or out?" : "+ Flying in or out? (optional)"}
        </button>
        {showFlight && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
            <FlightScanButton
              onParsed={(direction, localDateTime) =>
                onFlightChange({ ...flight, [direction]: localDateTime })
              }
            />
            <label className="ob-label" htmlFor="ob-arrival" style={{ marginTop: 0 }}>
              Landing
            </label>
            <input
              id="ob-arrival"
              type="datetime-local"
              className="ob-field"
              value={flight.arrival}
              onChange={(e) => onFlightChange({ ...flight, arrival: e.target.value })}
            />
            <label className="ob-label" htmlFor="ob-departure">
              Leaving
            </label>
            <input
              id="ob-departure"
              type="datetime-local"
              className="ob-field"
              value={flight.departure}
              onChange={(e) => onFlightChange({ ...flight, departure: e.target.value })}
            />
            <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 10 }}>
              We&apos;ll match you with others flying near the same time. Just the time,
              nothing else. Edit anytime on Me.
            </p>
          </div>
        )}
      </div>

      {error && (
        <p style={{ color: "var(--danger)", fontSize: 14, marginTop: 16 }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
        <button type="button" className="ob-back" onClick={onBack}>
          Back
        </button>
        <button type="button" className="ob-primary" onClick={onFinish} disabled={busy}>
          {busy ? "Finishing…" : "Finish"}
        </button>
      </div>
    </>
  );
}
