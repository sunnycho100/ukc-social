import { requireUser } from "@/lib/supabase/server";
import { getConference } from "@/lib/conference";
import { DEFAULT_RIDE_WINDOW_HOURS, toLocalInput } from "@/lib/rides";
import { type Hangout, type HangoutMember } from "@/lib/hangouts";
import RidePoolCard from "./RidePoolCard";
import HangoutBoard from "./HangoutBoard";

type Direction = "arrival" | "departure";
type FlightRow = { direction: Direction; scheduled_at: string; window_hours: number | null };
type PoolMember = { id: string; name: string; photo_url: string | null };
type PoolInfo = { direction: Direction; poolId: string; pickupAt: string; members: PoolMember[] };

// Just the data-dependent list — shared by the standalone /rides route and the
// combined /matching (Meals | Rides) tab, so both read from one implementation.
// One card per direction (arrival/departure), not a browsable list of
// everyone's flights: matching is automatic (see app/actions/flights.ts),
// same "you see your table, not everyone's" shape as Home's meal cards.
export async function RidesListSection() {
  const { user, supabase } = await requireUser();
  const conference = await getConference(supabase);
  const timezone = conference?.timezone ?? "America/New_York";

  const { data: flightRows } = await supabase
    .from("flights")
    .select("direction, scheduled_at, window_hours")
    .eq("user_id", user.id);
  const flights = (flightRows ?? []) as FlightRow[];
  const windowHours =
    flights.find((f) => f.window_hours)?.window_hours ??
    DEFAULT_RIDE_WINDOW_HOURS;

  // Conference dates as a starting point when nothing is saved, so the picker
  // does not open on a blank year/month/day. Same reasoning as /me.
  const defaults = {
    arrival: conference ? `${toLocalInput(conference.starts_at, timezone).slice(0, 10)}T12:00` : "",
    departure: conference ? `${toLocalInput(conference.ends_at, timezone).slice(0, 10)}T12:00` : "",
  };

  const { data: myMembership } = await supabase.from("ride_members").select("pool_id").eq("user_id", user.id);
  const myPoolIds = (myMembership ?? []).map((m) => m.pool_id as string);

  const poolByDirection = new Map<Direction, PoolInfo>();
  if (myPoolIds.length) {
    const { data: poolRows } = await supabase
      .from("ride_pools")
      .select("id, direction, pickup_at")
      // Hangout pools live in these same two tables (migration 0030) and are
      // rendered by HangoutBoard below, so they are filtered out here rather
      // than fetched and then dropped on the floor by the loop at the bottom.
      .in("direction", ["arrival", "departure"])
      .in("id", myPoolIds);
    const flightPoolIds = (poolRows ?? []).map((p) => p.id as string);
    const { data: memberRows } = flightPoolIds.length
      ? await supabase
          .from("ride_members")
          .select("pool_id, user_id, profile:directory_profiles(id, name, photo_url)")
          .in("pool_id", flightPoolIds)
      : { data: [] as { pool_id: string; user_id: string; profile: PoolMember | null }[] };

    const membersByPool = new Map<string, PoolMember[]>();
    for (const r of (memberRows ?? []) as { pool_id: string; user_id: string; profile: PoolMember | PoolMember[] | null }[]) {
      const p = Array.isArray(r.profile) ? r.profile[0] : r.profile;
      if (!p || p.id === user.id) continue;
      const list = membersByPool.get(r.pool_id) ?? [];
      list.push(p);
      membersByPool.set(r.pool_id, list);
    }

    for (const p of poolRows ?? []) {
      poolByDirection.set(p.direction as Direction, {
        direction: p.direction as Direction,
        poolId: p.id as string,
        pickupAt: p.pickup_at as string,
        members: membersByPool.get(p.id as string) ?? [],
      });
    }
  }

  return (
    <>
      {(["arrival", "departure"] as Direction[]).map((dir) => {
        const flight = flights.find((f) => f.direction === dir);
        const pool = poolByDirection.get(dir) ?? null;
        return (
          <RidePoolCard
            key={dir}
            direction={dir}
            hasFlight={!!flight}
            pool={pool ? { poolId: pool.poolId, pickupAt: pool.pickupAt, members: pool.members } : null}
            timezone={timezone}
            initialLocal={flight ? toLocalInput(flight.scheduled_at, timezone) : ""}
            defaultLocal={defaults[dir]}
            windowHours={windowHours}
          />
        );
      })}
      <HangoutsSection
        myPoolIds={myPoolIds}
        timezone={timezone}
        nowIso={new Date().toISOString()}
      />
    </>
  );
}

// Hangouts leaving the hotel: a browse-and-join board rather than the automatic
// matching the flight cards above get. There is no matching a destination out of
// a time, so somebody declares one and other people opt in.
async function HangoutsSection({
  myPoolIds,
  timezone,
  nowIso,
}: {
  myPoolIds: string[];
  timezone: string;
  nowIso: string;
}) {
  const { supabase } = await requireUser();

  const { data: poolRows } = await supabase
    .from("ride_pools")
    .select("id, title, pickup_at, capacity, meet_point")
    .eq("direction", "hangout")
    .gt("pickup_at", nowIso)
    .order("pickup_at", { ascending: true });

  const poolIds = (poolRows ?? []).map((p) => p.id as string);

  // Names and photos come off the public roster view so the board can show who
  // is in a hangout you have not joined.
  const { data: memberRows } = poolIds.length
    ? await supabase
        .from("ride_members")
        .select("pool_id, user_id, profile:directory_profiles(id, name, photo_url)")
        .in("pool_id", poolIds)
    : { data: [] as { pool_id: string; user_id: string; profile: HangoutMember | null }[] };

  const memberIds = [...new Set((memberRows ?? []).map((r) => r.user_id as string))];

  // Handles come off the base table instead, where profiles.p_sel (0008) only
  // returns a row when the caller shares a channel with that person, which since
  // 0023 includes sitting in the same ride_members. So this comes back populated
  // for hangouts you are in and empty for the rest, and "contacts unlock when
  // you join" is enforced by the database rather than by the component that
  // draws the list.
  const { data: contactRows } = memberIds.length
    ? await supabase.from("profiles").select("id, kakao").in("id", memberIds)
    : { data: [] as { id: string; kakao: string | null }[] };
  const kakaoById = new Map((contactRows ?? []).map((r) => [r.id as string, (r.kakao as string) ?? ""]));

  const membersByPool = new Map<string, HangoutMember[]>();
  for (const r of (memberRows ?? []) as {
    pool_id: string;
    user_id: string;
    profile: HangoutMember | HangoutMember[] | null;
  }[]) {
    const p = Array.isArray(r.profile) ? r.profile[0] : r.profile;
    if (!p) continue;
    const list = membersByPool.get(r.pool_id) ?? [];
    list.push({ ...p, kakao: kakaoById.get(r.user_id) ?? "" });
    membersByPool.set(r.pool_id, list);
  }

  const hangouts: Hangout[] = (poolRows ?? []).map((p) => ({
    id: p.id as string,
    title: p.title as string,
    leaveAt: p.pickup_at as string,
    meetPoint: p.meet_point as string,
    capacity: p.capacity as number,
    members: membersByPool.get(p.id as string) ?? [],
  }));

  return (
    <HangoutBoard
      hangouts={hangouts}
      myPoolIds={myPoolIds}
      timezone={timezone}
      defaultLocal={`${toLocalInput(nowIso, timezone).slice(0, 10)}T18:00`}
    />
  );
}

export default async function RidesPage() {
  const supabase = (await requireUser()).supabase;
  const conference = await getConference(supabase);

  return (
    <section className="rides">
      <header className="rides-head">
        <p className="rides-kicker">
          {[conference?.airport_code, conference?.name].filter(Boolean).join(" · ") || "Icebreaker"}
        </p>
        <h1 className="rides-title">Rides</h1>
        <p className="rides-sub">
          Post your flight and we&apos;ll match you with people flying near your time.
        </p>
      </header>

      <RidesListSection />

      <style>{`
        .rides { padding: 28px 20px 24px; }
        .rides-head { margin-bottom: 20px; }
        .rides-kicker {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--accent);
        }
        .rides-title {
          font-size: 40px;
          font-weight: 800;
          line-height: 1;
          letter-spacing: -0.03em;
          margin-top: 10px;
        }
        .rides-sub {
          margin-top: 10px;
          font-size: 15px;
          color: var(--ink-2);
          max-width: 34ch;
        }
      `}</style>
    </section>
  );
}
