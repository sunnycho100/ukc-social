import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import SignupGate from "@/components/SignupGate";
import { AddFlightForm } from "./AddFlightForm";
import type { Direction } from "@/lib/rides";

// Stored instants are event-offset; render them back as MCO wall-clock for the
// datetime-local input.
function toLocalInput(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

export default async function AddFlightPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const { user, supabase } = await requireUser();
  if (user.is_anonymous) {
    return (
      <SignupGate
        title="Post your flight"
        blurb="Share your airport ride with everyone landing in your window."
        next="/rides/add"
      />
    );
  }
  const direction: Direction = (await searchParams).d === "departure" ? "departure" : "arrival";

  // Prefill this direction's existing flight, if any. flights table may not exist
  // yet (migration 0006 pending) → just render an empty form.
  let initial: {
    direction: Direction;
    flightNo?: string;
    airline?: string;
    otherCity?: string;
    otherIata?: string;
    localDateTime?: string;
    luggage?: boolean;
  } = { direction };
  const { data, error } = await supabase
    .from("flights")
    .select("direction, flight_no, airline, other_city, other_iata, scheduled_at, luggage")
    .eq("user_id", user.id)
    .eq("direction", direction)
    .maybeSingle();
  if (!error && data) {
    initial = {
      direction,
      flightNo: data.flight_no ?? "",
      airline: data.airline ?? "",
      otherCity: data.other_city ?? "",
      otherIata: data.other_iata ?? "",
      localDateTime: data.scheduled_at ? toLocalInput(data.scheduled_at) : "",
      luggage: data.luggage ?? true,
    };
  }

  return (
    <section style={{ padding: "24px 20px 32px", maxWidth: 520, margin: "0 auto" }}>
      <Link href="/rides" className="af-back" aria-label="Back to rides">
        ‹ Rides
      </Link>

      <h1
        style={{
          fontSize: 34,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          lineHeight: 1.05,
          marginTop: 18,
          textWrap: "balance",
        }}
      >
        Add your flight
      </h1>
      <p style={{ marginTop: 12, fontSize: 15, color: "var(--ink-2)", maxWidth: "42ch" }}>
        Post it once and everyone landing in your window can split a car. Alone it&apos;s
        about $60; shared it&apos;s closer to $20 each.
      </p>

      <AddFlightForm initial={initial} />

      <style>{`
        .af-back {
          display: inline-flex; align-items: center; min-height: 44px;
          font-size: 15px; font-weight: 600; color: var(--ink-2);
        }
      `}</style>
    </section>
  );
}
