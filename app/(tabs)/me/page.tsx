import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { toLocalInput } from "@/lib/rides";
import { getConference } from "@/lib/conference";
import SignupGate from "@/components/SignupGate";
import ProfileEditor from "@/components/ProfileEditor";

const fmtSlot = (timezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

export default async function MePage() {
  const { user, supabase } = await requireUser();
  if (user.is_anonymous) {
    return (
      <SignupGate
        title="Create your profile"
        blurb="Save your photo, interests, and details so we can seat and match you well."
      />
    );
  }

  const conference = await getConference(supabase);
  const slotFmt = fmtSlot(conference?.timezone ?? "America/New_York");

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, school, position, interests, bio, kakao, linkedin, instagram, dietary, photo_url")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) redirect("/welcome");

  const { data: signupRows } = await supabase
    .from("signups")
    .select("slot:slots(id, title, starts_at)")
    .eq("user_id", user.id);
  const dinners = (signupRows ?? [])
    .map((r: any) => one<{ id: string; title: string; starts_at: string }>(r.slot))
    .filter((s: any): s is { id: string; title: string; starts_at: string } => !!s)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

  const { data: groupRows } = await supabase
    .from("group_members")
    .select("group:groups(id, name)")
    .eq("user_id", user.id);
  const tables = (groupRows ?? [])
    .map((r: any) => one<{ id: string; name: string }>(r.group))
    .filter((g: any): g is { id: string; name: string } => !!g);

  // flights table may not exist yet on a fresh DB — degrade to no flights set.
  const { data: flightRows } = await supabase
    .from("flights")
    .select("direction, scheduled_at, window_hours")
    .eq("user_id", user.id);
  const arrivalFlight = (flightRows ?? []).find((f) => f.direction === "arrival");
  const departureFlight = (flightRows ?? []).find((f) => f.direction === "departure");
  const windowHours = (arrivalFlight?.window_hours ?? departureFlight?.window_hours ?? 2) as number;
  const timezone = conference?.timezone ?? "America/New_York";
  // Conference dates as a starting point when nothing's saved yet — a blank
  // datetime-local input means setting year/month/day/hour/minute from
  // scratch, same reasoning as onboarding's StepPlans.
  const flightDefaults = {
    arrival: conference ? `${toLocalInput(conference.starts_at, timezone).slice(0, 10)}T12:00` : "",
    departure: conference ? `${toLocalInput(conference.ends_at, timezone).slice(0, 10)}T12:00` : "",
  };

  return (
    <section style={{ padding: "24px 20px" }}>
      <header className="page-head">
        <p className="page-kicker">{conference?.name ?? "Icebreaker"}</p>
        <h1 className="page-title">Me</h1>
        <p className="page-sub">Your profile, dinners, and tables.</p>
      </header>

      <ProfileEditor
        userId={user.id}
        initial={profile}
        initialFlight={{
          arrival: arrivalFlight ? toLocalInput(arrivalFlight.scheduled_at, timezone) : "",
          departure: departureFlight ? toLocalInput(departureFlight.scheduled_at, timezone) : "",
        }}
        flightDefaults={flightDefaults}
        initialWindowHours={windowHours}
        timezone={timezone}
      />

      <div style={{ marginTop: 36 }}>
        <h2 className="sec-h">My dinners</h2>
        {dinners.length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 8 }}>
            No dinners yet.{" "}
            <Link href="/meals" style={{ color: "var(--accent)", fontWeight: 600 }}>
              Find a table
            </Link>
          </p>
        ) : (
          <div style={{ marginTop: 8 }}>
            {dinners.map((d) => (
              <Link key={d.id} href="/meals" className="list-row">
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
                  {d.title}
                </span>
                <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                  {slotFmt.format(new Date(d.starts_at)).replace(", ", " · ")}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 32 }}>
        <h2 className="sec-h">My tables</h2>
        {tables.length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 8 }}>
            {/* A table stays hidden until its reveal, so an empty list is not
                the same as never having been seated. Saying "none assigned"
                to someone with dinners below contradicts the page above it. */}
            {dinners.length > 0
              ? "Your tables appear here once they open."
              : "No tables assigned yet."}
          </p>
        ) : (
          <div style={{ marginTop: 8 }}>
            {tables.map((t) => (
              <Link key={t.id} href={`/groups/${t.id}`} className="list-row">
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
                  {t.name}
                </span>
                <span style={{ fontSize: 14, color: "var(--accent)", fontWeight: 600 }}>
                  →
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <style>{`
        /* Matches Home's .hub-head and Schedule's .board-label. This was the
           one screen setting its section labels in tracked uppercase, which
           made three shouted eyebrows on a page whose content is a profile,
           and made Me look like a different app from Home. */
        .sec-h {
          font-size: 13px;
          font-weight: 600;
          color: var(--ink-3);
        }
        .list-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 0;
          border-bottom: 1px solid var(--line);
        }
        .list-row:last-child { border-bottom: none; }
      `}</style>
    </section>
  );
}
