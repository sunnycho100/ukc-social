import { requireUser } from "@/lib/supabase/server";
import { EVENT_AIRPORT } from "@/lib/rides";
import { Board, type Row } from "./Board";

const timeFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
});

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

type FlightRow = {
  id: string;
  user_id: string;
  direction: "arrival" | "departure";
  other_city: string;
  other_iata: string;
  airline: string;
  flight_no: string;
  scheduled_at: string;
  profile: { name: string } | { name: string }[] | null;
};

export default async function RidesPage() {
  const { user, supabase } = await requireUser();

  // flights table may not exist yet (migration 0006 pending) → treat as empty.
  const { data, error } = await supabase
    .from("flights")
    .select(
      "id, user_id, direction, other_city, other_iata, airline, flight_no, scheduled_at, profile:profiles(name)",
    )
    .eq("airport", EVENT_AIRPORT)
    .order("scheduled_at", { ascending: true });

  const flights: FlightRow[] = error ? [] : ((data as FlightRow[]) ?? []);

  const toRow = (f: FlightRow): Row => {
    const t = new Date(f.scheduled_at).getTime();
    return {
      id: f.id,
      name: one<{ name: string }>(f.profile)?.name || "Someone",
      timeLabel: timeFmt.format(t),
      city: f.other_city,
      iata: f.other_iata,
      airline: f.airline,
      flightNumber: f.flight_no,
      scheduledMs: t,
      isMe: f.user_id === user.id,
    };
  };

  const arrivals = flights.filter((f) => f.direction === "arrival").map(toRow);
  const departures = flights.filter((f) => f.direction === "departure").map(toRow);

  return (
    <section className="rides">
      <header className="page-head">
        <p className="page-kicker">Orlando MCO · UKC 2026</p>
        <h1 className="page-title">Rides</h1>
        <p className="page-sub">See who flies near your time, then split a car.</p>
      </header>

      <Board arrivals={arrivals} departures={departures} />

      <RidesStyles />
    </section>
  );
}

function RidesStyles() {
  return (
    <style>{`
      .rides { padding: 28px 20px 24px; }

      /* direction toggle — editorial text tabs, not a grey segmented control */
      .board-dir { display: flex; gap: 22px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
      .board-dir-on, .board-dir-off {
        background: none; border: none; padding: 11px 0; min-height: 44px; cursor: pointer;
        font-family: var(--font-display), sans-serif;
        font-size: 18px; font-weight: 700; letter-spacing: -0.01em;
      }
      .board-dir-on { color: var(--ink); box-shadow: inset 0 -2px 0 0 var(--accent); }
      .board-dir-off { color: var(--ink-3); }
      .board-hint { font-size: 13px; color: var(--ink-2); margin: 14px 0 2px; }

      /* the board — hairline-divided rows, no cards */
      .board { border-bottom: 1px solid var(--line); margin: 8px 0 20px; }
      .arr { border-top: 1px solid var(--line); }
      /* The 7% wash alone is ~1.07:1 against the page — invisible outdoors and
         meaningless to AT. The inset rule carries the signal; the tint is mood. */
      .arr-hot {
        background: color-mix(in srgb, var(--accent) 7%, transparent);
        box-shadow: inset 2px 0 0 0 var(--accent);
      }
      .arr-near {
        font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
        text-transform: uppercase; color: var(--accent); white-space: nowrap;
      }
      .arr-main {
        display: grid;
        grid-template-columns: auto 1fr auto;
        column-gap: 14px;
        align-items: baseline;
        padding: 16px 8px;
      }
      .arr-time {
        font-family: var(--font-display), sans-serif;
        font-size: 19px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
        color: var(--ink);
        white-space: nowrap;
      }
      .arr-body { min-width: 0; }
      /* wrap + shrink so a long Korean name doesn't push the badges out */
      .arr-name { font-size: 16px; font-weight: 600; color: var(--ink); display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; }
      .arr-name-text { min-width: 0; overflow-wrap: anywhere; }
      .arr-you {
        font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
        color: var(--accent);
      }
      .arr-meta { font-size: 13px; color: var(--ink-2); margin-top: 3px; text-wrap: pretty; }
      .arr-share {
        align-self: center;
        min-height: 44px;
        padding: 0 6px;
        background: none;
        border: none;
        color: var(--accent);
        font-size: 14px;
        font-weight: 700;
        white-space: nowrap;
        cursor: pointer;
      }
      .arr-share span { margin-left: 2px; display: inline-block; transition: transform 0.15s ease; }
      .arr-share:hover span { transform: translateX(3px); }
      .arr-done {
        align-self: center;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        font-size: 13px;
        font-weight: 600;
        color: var(--ink-2);
        white-space: nowrap;
      }
      /* hairline band, not a card — matches the rest of the board */
      .arr-ack {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 0 8px 10px;
        padding: 4px 0 6px;
        border-top: 1px solid var(--accent);
        font-size: 13px;
        color: var(--ink);
      }
      .arr-ack:empty { display: none; }
      .arr-undo {
        flex-shrink: 0;
        min-height: 44px;
        padding: 0 12px;
        background: none;
        border: none;
        color: var(--accent);
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }

      .rides-empty {
        margin-top: 44px;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
      }
      .rides-empty-title { font-family: var(--font-display), sans-serif; font-size: 18px; font-weight: 700; color: var(--ink); }
      .rides-empty-sub { font-size: 14px; color: var(--ink-2); max-width: 34ch; }

      .add-btn {
        display: inline-flex;
        align-items: center;
        align-self: flex-start;
        min-height: 44px;
        padding: 0 18px;
        border-radius: 999px;
        border: 1px solid var(--accent);
        background: none;
        color: var(--accent);
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .add-btn:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
      .rides-empty .add-btn { align-self: center; margin-top: 12px; }
    `}</style>
  );
}
