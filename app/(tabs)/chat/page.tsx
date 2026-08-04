import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { getConference } from "@/lib/conference";

const dtf = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type Row = {
  key: string;
  href: string;
  name: string;
  lastBody: string;
  lastAt: string | null;
  // null means "this thread can't track reads yet", which is not the same as 0.
  // Only tables have a message_reads row; see the note on the ride rows below.
  unread: number | null;
};

type GroupRef = { id: string; name: string };
type PoolRef = { id: string; direction: "arrival" | "departure" };
type FriendReq = { id: string; slug: string; from_user_id: string; to_user_id: string };
type MessageRow = { channel_id: string; body: string; created_at: string };

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

// Just the data-dependent list, the same shape MealsListSection/RidesListSection
// already use, so the combined 친구 tab can render it beside the people browser
// without a second implementation. Returns the unread total alongside the node:
// chat is no longer the default segment, so that count has to reach the segment
// label or it would sit one tap out of sight.
export async function ChatListSection(): Promise<{ node: React.ReactNode; unread: number }> {
  const { user, supabase } = await requireUser();

  const { data: groupRows } = await supabase
    .from("group_members")
    .select("group:groups(id, name)")
    .eq("user_id", user.id);
  const groups = (groupRows ?? [])
    .map((r) => one<GroupRef>(r.group))
    .filter((g): g is GroupRef => !!g);
  const groupIds = groups.map((g) => g.id);

  // Ride threads belong in this list too. The page promises "every table and
  // ride you're part of" but only ever queried tables, so a ride conversation
  // was reachable from the Rides segment of 매칭 and nowhere else.
  const { data: memberRows } = await supabase
    .from("ride_members")
    .select("pool_id")
    .eq("user_id", user.id);
  const poolIds = (memberRows ?? []).map((r) => r.pool_id as string);

  const { data: poolRows } = poolIds.length
    ? await supabase.from("ride_pools").select("id, direction").in("id", poolIds)
    : { data: [] as PoolRef[] };
  const pools = (poolRows ?? []) as PoolRef[];

  // Direct threads. hi_sel already limits this to requests you are a party to,
  // so accepted is the only filter this needs. The thread's id is the request's
  // id (migration 0023), which is also its messages.channel_id.
  //
  // Names come from a second query rather than an embedded join: hi_requests has
  // two foreign keys into profiles, so PostgREST needs the constraint name to
  // disambiguate them, and that ties the query to a name Postgres generated.
  const { data: friendRows } = await supabase
    .from("hi_requests")
    .select("id, slug, from_user_id, to_user_id")
    .eq("status", "accepted");
  const friendReqs = (friendRows ?? []) as FriendReq[];
  const otherIds = friendReqs.map((r) => (r.from_user_id === user.id ? r.to_user_id : r.from_user_id));
  const { data: friendProfiles } = otherIds.length
    ? await supabase.from("profiles").select("id, name").in("id", otherIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map((friendProfiles ?? []).map((p) => [p.id as string, p.name as string]));
  const friends = friendReqs.map((r) => ({
    // id keys the messages, slug addresses the page. See migration 0024.
    id: r.id,
    slug: r.slug,
    name: nameById.get(r.from_user_id === user.id ? r.to_user_id : r.from_user_id) || "Someone",
  }));
  const friendIds = friends.map((f) => f.id);

  const { data: reads } = groupIds.length
    ? await supabase
        .from("message_reads")
        .select("group_id, last_read_at")
        .eq("user_id", user.id)
        .in("group_id", groupIds)
    : { data: [] as { group_id: string; last_read_at: string }[] };
  const lastReadByGroup = new Map((reads ?? []).map((r) => [r.group_id, r.last_read_at]));

  // Two queries rather than one over both channel types: messages.channel_id is
  // a bare uuid with no foreign key, so a group id and a pool id are
  // indistinguishable unless channel_type is part of the filter.
  const [mealRes, rideRes, directRes] = await Promise.all([
    groupIds.length
      ? supabase
          .from("messages")
          .select("channel_id, body, created_at")
          .eq("channel_type", "meal")
          .in("channel_id", groupIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as MessageRow[] }),
    poolIds.length
      ? supabase
          .from("messages")
          .select("channel_id, body, created_at")
          .eq("channel_type", "ride")
          .in("channel_id", poolIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as MessageRow[] }),
    friendIds.length
      ? supabase
          .from("messages")
          .select("channel_id, body, created_at")
          .eq("channel_type", "direct")
          .in("channel_id", friendIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as MessageRow[] }),
  ]);

  const tableRows: Row[] = groups.map((g) => {
    const msgs = (mealRes.data ?? []).filter((m) => m.channel_id === g.id);
    const last = msgs[msgs.length - 1];
    const lastReadAt = lastReadByGroup.get(g.id);
    return {
      key: `meal:${g.id}`,
      href: `/groups/${g.id}/chat`,
      name: g.name,
      lastBody: last?.body ?? "No messages yet.",
      lastAt: last?.created_at ?? null,
      unread: lastReadAt
        ? msgs.filter((m) => new Date(m.created_at).getTime() > new Date(lastReadAt).getTime()).length
        : msgs.length,
    };
  });

  // Ride rows carry no unread count. message_reads.group_id is declared
  // `references groups`, so a read marker keyed by a pool id fails the foreign
  // key. A real badge for rides needs a migration widening that table to
  // (channel_type, channel_id). Listing the thread does not, and the thread
  // being unreachable was the actual problem.
  const rideRows: Row[] = pools.map((p) => {
    const msgs = (rideRes.data ?? []).filter((m) => m.channel_id === p.id);
    const last = msgs[msgs.length - 1];
    return {
      key: `ride:${p.id}`,
      href: `/rides/${p.id}/chat`,
      name: p.direction === "arrival" ? "Arrival ride" : "Departure ride",
      lastBody: last?.body ?? "No messages yet.",
      lastAt: last?.created_at ?? null,
      unread: null,
    };
  });

  // Same no-badge reason as rides: message_reads.group_id references groups, so
  // a read marker keyed by a request id fails the foreign key.
  const directRows: Row[] = friends.map((f) => {
    const msgs = (directRes.data ?? []).filter((m) => m.channel_id === f.id);
    const last = msgs[msgs.length - 1];
    return {
      key: `direct:${f.id}`,
      href: `/dm/${f.slug}`,
      name: f.name,
      lastBody: last?.body ?? "No messages yet.",
      lastAt: last?.created_at ?? null,
      unread: null,
    };
  });

  const rows = [...tableRows, ...rideRows, ...directRows].sort(
    (a, b) =>
      new Date(b.lastAt ?? 0).getTime() - new Date(a.lastAt ?? 0).getTime() ||
      a.name.localeCompare(b.name),
  );

  const node = (
    <>
      {rows.length === 0 ? (
        <p style={{ color: "var(--ink-2)", fontSize: 15, paddingTop: 8 }}>
          No conversations yet. Connect with someone, or join a dinner or ride.
        </p>
      ) : (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line)" }}>
          {rows.map((r) => (
            <Link
              key={r.key}
              href={r.href}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "16px 0",
                borderBottom: "1px solid var(--line)",
                textDecoration: "none",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{r.name}</div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--ink-2)",
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 240,
                  }}
                >
                  {r.lastBody}
                </div>
              </div>
              <div style={{ flexShrink: 0, textAlign: "right" }}>
                {r.lastAt && (
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{dtf.format(new Date(r.lastAt))}</div>
                )}
                {r.unread !== null && r.unread > 0 && (
                  <span
                    style={{
                      display: "inline-block",
                      marginTop: 4,
                      minWidth: 18,
                      padding: "2px 6px",
                      borderRadius: 999,
                      background: "var(--accent)",
                      color: "var(--accent-ink)",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {r.unread}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );

  // Tables only. Ride threads carry no read marker yet (see the note above), so
  // counting them would mean counting every ride message forever.
  const unread = tableRows.reduce((n, r) => n + (r.unread ?? 0), 0);
  return { node, unread };
}

// Standalone route, kept for direct links. The tab bar points at /people, which
// renders this same section beside the people browser.
export default async function ChatIndexPage() {
  const supabase = (await requireUser()).supabase;
  const conference = await getConference(supabase);
  const { node } = await ChatListSection();

  return (
    <section style={{ padding: "24px 20px" }}>
      <header className="page-head">
        <h1 className="page-title">Chat</h1>
        <p className="page-sub">Every table and ride you&apos;re part of.</p>
      </header>
      {node}
    </section>
  );
}
