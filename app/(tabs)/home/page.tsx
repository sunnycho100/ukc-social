import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { getConference } from "@/lib/conference";
import Wordmark from "@/components/Wordmark";

const HOUR = 3600_000;

const fmtTime = (timezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
const fmtDate = (timezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  });

const ms = (s: string) => new Date(s).getTime();
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "Someone";

type Slot = { id: string; title: string; starts_at: string; area: string; join_deadline: string };
type Group = {
  id: string;
  name: string;
  rationale: string;
  starter_question: string;
  meet_time: string | null;
  slot: Slot | null;
};
type TableMember = {
  id: string;
  name: string;
  photo_url: string | null;
  school: string;
  position: string;
  interests: string[];
};
type TableCard = {
  groupId: string;
  tableName: string;
  starterQuestion: string;
  slot: Slot;
  members: TableMember[];
};

export default async function HomePage() {
  const { user, supabase } = await requireUser();
  const conference = await getConference(supabase);
  if (user.is_anonymous) return <GuestHomeSection conferenceName={conference?.name} />;
  const now = Date.now();
  const timeFmt = fmtTime(conference?.timezone ?? "America/New_York");
  const dateFmt = fmtDate(conference?.timezone ?? "America/New_York");

  const { data: prof } = await supabase
    .from("profiles")
    .select("name, interests")
    .eq("id", user.id)
    .maybeSingle();
  if (!prof) redirect("/welcome");
  const profile = { name: prof.name ?? "" };
  const myInterests = new Set(((prof.interests as string[]) ?? []).map((i) => i.toLowerCase()));

  const { data: groupRows } = await supabase
    .from("group_members")
    .select(
      "group:groups(id, name, rationale, starter_question, meet_time, slot:slots(id, title, starts_at, area, join_deadline))",
    )
    .eq("user_id", user.id);

  const myGroups: Group[] = (groupRows ?? [])
    .map((r: any) => {
      const g = one<any>(r.group);
      return g ? ({ ...g, slot: one<Slot>(g.slot) } as Group) : null;
    })
    .filter((g: Group | null): g is Group => !!g && !!g.slot);

  // Earliest group whose slot hasn't long passed (allow 3h grace after start).
  const nextGroup =
    myGroups
      .filter((g) => ms(g.slot!.starts_at) >= now - 3 * HOUR)
      .sort((a, b) => ms(a.slot!.starts_at) - ms(b.slot!.starts_at))[0] ?? null;

  const memberNames: string[] = [];
  if (nextGroup) {
    const { data: memberRows } = await supabase
      .from("group_members")
      .select("profile:profiles(name)")
      .eq("group_id", nextGroup.id);
    for (const r of memberRows ?? []) {
      const p = one<{ name: string }>((r as any).profile);
      if (p) memberNames.push(firstName(p.name));
    }
  }

  const { data: signupRows } = await supabase
    .from("signups")
    .select("slot:slots(id, title, starts_at, area, join_deadline)")
    .eq("user_id", user.id);
  const signupSlots: Slot[] = (signupRows ?? [])
    .map((r: any) => one<Slot>(r.slot))
    .filter((s: Slot | null): s is Slot => !!s);
  const nextSignup =
    signupSlots
      .filter((s) => ms(s.starts_at) >= now)
      .sort((a, b) => ms(a.starts_at) - ms(b.starts_at))[0] ?? null;

  // How many have signed up for the slot you're waiting on (for the waiting-state momentum).
  let waitingCount = 0;
  if (nextSignup) {
    const { count } = await supabase
      .from("signups")
      .select("*", { count: "exact", head: true })
      .eq("slot_id", nextSignup.id);
    waitingCount = count ?? 0;
  }

  const dayOf = nextGroup && ms(nextGroup.slot!.starts_at) - now <= 3 * HOUR;

  // --- "Line these up" hub signals (each resilient to the pending migration) ---
  const dinnerDone = !!nextGroup || !!nextSignup;

  // Social proof for the dinner nudge: the soonest still-open meal you're not in.
  let dinnerHook: { title: string; count: number } | null = null;
  if (!dinnerDone) {
    const { data: openSlots } = await supabase
      .from("slots")
      .select("id, title")
      .eq("kind", "meal")
      .gte("join_deadline", new Date(now).toISOString())
      .order("starts_at", { ascending: true })
      .limit(1);
    const s = openSlots?.[0] as { id: string; title: string } | undefined;
    if (s) {
      const { count } = await supabase
        .from("signups")
        .select("*", { count: "exact", head: true })
        .eq("slot_id", s.id);
      dinnerHook = { title: s.title, count: count ?? 0 };
    }
  }

  // Has the user posted a flight? (flights table may not exist yet → nudge shows.)
  let hasFlight = false;
  const fl = await supabase.from("flights").select("id").eq("user_id", user.id).limit(1);
  if (!fl.error && fl.data && fl.data.length) hasFlight = true;

  // 친구 tab shows only people you actually share a group with — not the full
  // directory (that's "Meet other participants", which links to /people and
  // its full stay/interest/school filtering). One card per table (not a
  // flattened dedup list), so it's clear which slot each group is from —
  // and if only one table shows up, it's because matching's only actually
  // been run for one of your joined slots so far, not a bug.
  const groupIds = myGroups.map((g) => g.id);
  let tables: TableCard[] = [];
  if (groupIds.length) {
    const { data: memberRows } = await supabase
      .from("group_members")
      .select(
        "group_id, profile:directory_profiles(id, name, photo_url, school, position, interests)",
      )
      .in("group_id", groupIds);
    const membersByGroup = new Map<string, TableMember[]>();
    for (const r of (memberRows ?? []) as { group_id: string; profile: TableMember | TableMember[] | null }[]) {
      const p = one<TableMember>(r.profile);
      if (!p || p.id === user.id) continue; // show tablemates, not yourself
      const list = membersByGroup.get(r.group_id) ?? [];
      list.push(p);
      membersByGroup.set(r.group_id, list);
    }
    tables = myGroups
      .map((g) => ({
        groupId: g.id,
        tableName: g.name,
        starterQuestion: g.starter_question,
        slot: g.slot!,
        members: membersByGroup.get(g.id) ?? [],
      }))
      .sort((a, b) => ms(a.slot.starts_at) - ms(b.slot.starts_at));
  }

  return (
    <section style={{ padding: "24px 20px" }}>
      <header style={{ marginBottom: 24 }}>
        <Wordmark size="sm" />
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6 }}>
          {dateFmt.format(new Date(now))}
        </div>
      </header>

      {dayOf && nextGroup ? (
        <DayOf group={nextGroup} names={memberNames} timeFmt={timeFmt} />
      ) : nextGroup ? (
        <Revealed
          group={nextGroup}
          names={memberNames}
          timezone={conference?.timezone ?? "America/New_York"}
        />
      ) : nextSignup ? (
        <JoinedWaiting slot={nextSignup} count={waitingCount} timeFmt={timeFmt} />
      ) : (
        <Fresh name={profile.name} conferenceName={conference?.name} />
      )}

      <FillInHub dinner={dinnerDone ? null : dinnerHook} hasFlight={hasFlight} />

      <GroupmatesSection
        tables={tables}
        myInterests={myInterests}
        timezone={conference?.timezone ?? "America/New_York"}
      />

      <LinkStyles />
    </section>
  );
}

function Fresh({ name, conferenceName }: { name: string; conferenceName?: string }) {
  const greeting = name.trim() ? `Hey ${firstName(name)}` : "Welcome";
  return (
    <div>
      <div className="eyebrow">{conferenceName ?? "Icebreaker"}</div>
      <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 10, lineHeight: 1 }}>
        {greeting}
      </h1>
      <p style={{ color: "var(--ink-2)", marginTop: 12, fontSize: 15, maxWidth: "40ch" }}>
        Nothing on your plate yet. Here&apos;s how to get the most out of the week.
      </p>
    </div>
  );
}

// Line-drawn icons, reused from the tab bar so Home speaks the same visual language.
const ICONS = {
  meal: "M6 3v7a2 2 0 0 0 2 2v9M6 3v5m3-5v5m9-5c-1.5 1-2.5 3-2.5 6.5V12h2.5m0-9v18",
  people:
    "M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1.5a4 4 0 0 0-3-3.9M16 3.6a4 4 0 0 1 0 7.8",
  ride: "M5 16v3H3v-6l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v6h-2v-3H5m1.5-3.5h11M7 16h.5m9-.5h.5",
};

// A persistent "things to line up" list, each led by an icon and the concrete
// payoff, so Home stays a place to act rather than a wall of text.
function FillInHub({
  dinner,
  hasFlight,
}: {
  dinner: { title: string; count: number } | null;
  hasFlight: boolean;
}) {
  const rows: ReactNode[] = [];

  if (dinner) {
    const proof =
      dinner.count > 1
        ? `${dinner.count} already in for ${dinner.title}. Seated by what you actually work on.`
        : "Seated by what you actually work on, not at random.";
    rows.push(
      <NudgeRow key="dinner" href="/meals" icon={ICONS.meal} title="Grab a seat at dinner" benefit={proof} />,
    );
  }
  rows.push(
    <NudgeRow
      key="people"
      href="/people"
      icon={ICONS.people}
      title="Meet other participants"
      benefit="See who's coming and reach out before you arrive."
    />,
  );
  if (!hasFlight) {
    rows.push(
      <NudgeRow
        key="rides"
        href="/me"
        icon={ICONS.ride}
        title="Split a ride from the airport"
        benefit="$60 alone. About $20 each when you share."
      />,
    );
  }

  return (
    <div style={{ marginTop: 32 }}>
      <div className="hub-head">Line these up</div>
      <div className="hub-list">{rows}</div>
    </div>
  );
}

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "·";
}

// One card per table — only people you actually share a group with. The
// full, filterable directory lives behind "Meet other participants" (->
// /people). Deliberately one card per group (not a flattened people list),
// so it's obvious which slot/table each is from — and if only one card
// shows even though you joined several dinners, that's because matching's
// only actually been run for one of those slots so far, not a bug.
function GroupmatesSection({
  tables,
  myInterests,
  timezone,
}: {
  tables: TableCard[];
  myInterests: Set<string>;
  timezone: string;
}) {
  const fmt = fmtTime(timezone);
  const dfmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });

  return (
    <div style={{ marginTop: 32 }}>
      <div className="hub-head">Your tables</div>
      {tables.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 8 }}>
          No one yet — join a dinner and get matched to see your tablemates here.
        </p>
      ) : (
        tables.map((t) => (
          <div key={t.groupId} className="table-card">
            <div className="table-card__head">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{t.tableName}</div>
                <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>
                  {t.slot.title} · {dfmt.format(new Date(t.slot.starts_at))} ·{" "}
                  {fmt.format(new Date(t.slot.starts_at))}
                  {t.slot.area ? ` · ${t.slot.area}` : ""}
                </div>
                {t.starterQuestion && (
                  <div style={{ fontSize: 13, color: "var(--accent)", marginTop: 6, lineHeight: 1.4 }}>
                    💬 {t.starterQuestion}
                  </div>
                )}
              </div>
              <Link href={`/groups/${t.groupId}/chat`} className="table-card__chat">
                Chat
              </Link>
            </div>

            {t.members.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 10 }}>
                Just you so far — more may join before tables lock in.
              </p>
            ) : (
              t.members.map((p) => {
                const shared = p.interests.filter((i) => myInterests.has(i.toLowerCase()));
                return (
                  <div key={p.id} className="mate-row">
                    <div
                      aria-hidden
                      className="mate-avatar"
                      style={
                        p.photo_url
                          ? { background: `center/cover no-repeat url("${p.photo_url}")` }
                          : undefined
                      }
                    >
                      {!p.photo_url && initials(p.name)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{p.name}</div>
                      <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
                        {[p.school, p.position].filter(Boolean).join(" · ") || "—"}
                      </div>
                      {shared.length > 0 ? (
                        <div style={{ fontSize: 13, marginTop: 3 }}>
                          <span style={{ color: "var(--ink-3)" }}>you both like </span>
                          <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                            {shared.join(", ")}
                          </span>
                        </div>
                      ) : (
                        p.interests.length > 0 && (
                          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 3 }}>
                            into {p.interests.join(", ")}
                          </div>
                        )
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ))
      )}
    </div>
  );
}

function NudgeRow({
  href,
  icon,
  title,
  benefit,
}: {
  href: string;
  icon: string;
  title: string;
  benefit: string;
}) {
  return (
    <Link href={href} className="cta-row">
      <svg
        className="cta-ico"
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={icon} />
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>{title}</div>
        <div style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 4, textWrap: "pretty" }}>
          {benefit}
        </div>
      </div>
      <span className="cta-chev" aria-hidden>▸</span>
    </Link>
  );
}

function JoinedWaiting({
  slot,
  count,
  timeFmt,
}: {
  slot: Slot;
  count: number;
  timeFmt: Intl.DateTimeFormat;
}) {
  return (
    <div>
      <div className="eyebrow">You&apos;re in</div>
      <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 10, lineHeight: 1 }}>
        {slot.title}
      </h1>
      <p style={{ color: "var(--ink-2)", marginTop: 12, fontSize: 15 }}>
        {timeFmt.format(new Date(slot.starts_at))}
        {slot.area ? ` · ${slot.area}` : ""}
      </p>

      {count > 0 && (
        <div style={{ marginTop: 24 }}>
          {/* Anonymized: momentum without exposing who joined. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {Array.from({ length: Math.min(count, 14) }).map((_, i) => (
              <span key={i} style={{ width: 9, height: 9, borderRadius: 999, background: "var(--ink-3)" }} />
            ))}
            {count > 14 && (
              <span style={{ fontSize: 12, color: "var(--ink-3)", marginLeft: 2 }}>+{count - 14}</span>
            )}
          </div>
          <div style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 10 }}>
            <strong style={{ color: "var(--ink)" }}>{count}</strong> of Arendelle are in so
            far.
          </div>
        </div>
      )}

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
        <div style={{ fontSize: 15, color: "var(--ink)" }}>
          Tables assigned at{" "}
          <strong>{timeFmt.format(new Date(slot.join_deadline))}</strong>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4 }}>
          We&apos;ll seat you with people worth meeting.
        </div>
      </div>
      <Link href="/meals" className="text-link">
        Change plans
      </Link>
    </div>
  );
}

function Revealed({
  group,
  names,
  timezone,
}: {
  group: Group;
  names: string[];
  timezone: string;
}) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
  const when = group.slot
    ? [dtf.format(new Date(group.meet_time ?? group.slot.starts_at)), group.slot.area]
        .filter(Boolean)
        .join(" · ")
    : null;
  return (
    <div>
      <div className="eyebrow">Your table is set</div>
      <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 10, lineHeight: 1 }}>
        {group.name}
      </h1>
      {when && <p style={{ fontSize: 15, color: "var(--ink-2)", marginTop: 10 }}>{when}</p>}
      {names.length > 0 && (
        <p style={{ fontSize: 15, color: "var(--ink-2)", marginTop: 8 }}>{names.join(", ")}</p>
      )}
      {group.starter_question && (
        <p style={{ fontSize: 14, color: "var(--ink)", marginTop: 6, lineHeight: 1.4, maxWidth: "42ch" }}>
          💬 {group.starter_question}
        </p>
      )}
      {group.rationale && (
        <p
          style={{
            fontSize: 14,
            color: "var(--accent)",
            marginTop: 12,
            lineHeight: 1.5,
            maxWidth: "42ch",
          }}
        >
          {group.rationale}
        </p>
      )}
      <Link href={`/groups/${group.id}`} className="cta-line">
        Meet your table <span aria-hidden>▸</span>
      </Link>
    </div>
  );
}

function DayOf({
  group,
  names,
  timeFmt,
}: {
  group: Group;
  names: string[];
  timeFmt: Intl.DateTimeFormat;
}) {
  const meet = group.meet_time ?? group.slot?.starts_at ?? null;
  return (
    <div>
      <div className="eyebrow">Tonight</div>
      <h1 style={{ fontSize: 48, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 10, lineHeight: 1 }}>
        {meet ? timeFmt.format(new Date(meet)) : "Soon"}
      </h1>
      {group.starter_question && (
        <p style={{ fontSize: 16, color: "var(--ink)", marginTop: 8, fontWeight: 600, lineHeight: 1.4 }}>
          💬 {group.starter_question}
        </p>
      )}
      <p style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 10 }}>
        {group.name}
        {names.length ? ` · ${names.join(", ")}` : ""}
      </p>
      {group.rationale && (
        <p style={{ fontSize: 13, color: "var(--accent)", marginTop: 8, lineHeight: 1.5, maxWidth: "42ch" }}>
          {group.rationale}
        </p>
      )}
      <Link
        href={`/groups/${group.id}/chat`}
        style={{
          display: "block",
          textAlign: "center",
          marginTop: 24,
          padding: "15px",
          borderRadius: 999,
          fontSize: 16,
          fontWeight: 700,
          border: "1px solid var(--accent)",
          color: "var(--accent)",
        }}
      >
        Open chat ▸
      </Link>
    </div>
  );
}

// Home for an anonymous guest: no personal data, just what signing up unlocks.
function GuestHomeSection({ conferenceName }: { conferenceName?: string }) {
  return (
    <section style={{ padding: "24px 20px" }}>
      <div className="eyebrow">{conferenceName ?? "Icebreaker"}</div>
      <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 10, lineHeight: 1 }}>
        Look around
      </h1>
      <p style={{ color: "var(--ink-2)", marginTop: 12, fontSize: 15, maxWidth: "40ch" }}>
        Browse who&apos;s coming and what&apos;s on. Create an account when you want to join in.
      </p>
      <div style={{ marginTop: 28 }}>
        <div className="hub-head">Members can</div>
        <div className="hub-list">
          <NudgeRow href="/login" icon={ICONS.meal} title="Join a dinner" benefit="Seated with people matched to what you actually work on." />
          <NudgeRow href="/login" icon={ICONS.people} title="Meet other participants" benefit="See who's coming before you arrive." />
          <NudgeRow href="/login" icon={ICONS.ride} title="Split a ride from the airport" benefit="$60 alone. About $20 each when you share." />
        </div>
      </div>
      <Link
        href="/login"
        style={{
          display: "block",
          textAlign: "center",
          marginTop: 24,
          minHeight: 50,
          lineHeight: "50px",
          borderRadius: 12,
          background: "var(--accent)",
          color: "var(--accent-ink)",
          fontSize: 16,
          fontWeight: 700,
        }}
      >
        Create your account
      </Link>
      <LinkStyles />
    </section>
  );
}

function LinkStyles() {
  return (
    <style>{`
      .eyebrow {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--accent);
      }
      .text-link {
        display: inline-block;
        margin-top: 18px;
        font-size: 15px;
        font-weight: 600;
        color: var(--accent);
      }
      .cta-line {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 44px;
        margin-top: 16px;
        font-size: 15px;
        font-weight: 700;
        color: var(--accent);
      }
      .cta-line span { display: inline-block; transition: transform 0.15s ease; }
      .cta-line:hover span { transform: translateX(3px); }
      .cta-row {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 18px 0;
        border-top: 1px solid var(--line);
      }
      .cta-ico { flex-shrink: 0; color: var(--ink-2); }
      .cta-chev { flex-shrink: 0; color: var(--accent); font-weight: 700; transition: transform 0.15s ease; }
      .cta-row:hover .cta-chev { transform: translateX(3px); }
      .hub-head {
        font-size: 13px;
        font-weight: 600;
        color: var(--ink-3);
        margin-bottom: 2px;
      }
      .hub-list { border-bottom: 1px solid var(--line); }
      .table-card {
        margin-top: 12px;
        padding: 14px 16px;
        border: 1px solid var(--line);
        border-radius: 14px;
      }
      .table-card + .table-card { margin-top: 12px; }
      .table-card__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .table-card__chat {
        flex-shrink: 0;
        min-height: 32px;
        padding: 6px 14px;
        border-radius: 999px;
        border: 1px solid var(--accent);
        color: var(--accent);
        font-size: 13px;
        font-weight: 700;
        text-decoration: none;
      }
      .mate-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 0;
        border-top: 1px solid var(--line);
        margin-top: 10px;
      }
      .mate-avatar {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 1px solid var(--line);
        background: var(--surface);
        color: var(--ink-2);
        display: grid;
        place-items: center;
        font-size: 14px;
        font-weight: 600;
        overflow: hidden;
      }
    `}</style>
  );
}
