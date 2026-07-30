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
  groupId: string;
  name: string;
  lastBody: string;
  lastAt: string | null;
  unread: number;
};

type GroupRef = { id: string; name: string };

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

export default async function ChatIndexPage() {
  const { user, supabase } = await requireUser();
  const conference = await getConference(supabase);

  const { data: groupRows } = await supabase
    .from("group_members")
    .select("group:groups(id, name)")
    .eq("user_id", user.id);
  const groups = (groupRows ?? [])
    .map((r) => one<GroupRef>(r.group))
    .filter((g): g is GroupRef => !!g);
  const groupIds = groups.map((g) => g.id);

  const { data: reads } = groupIds.length
    ? await supabase
        .from("message_reads")
        .select("group_id, last_read_at")
        .eq("user_id", user.id)
        .in("group_id", groupIds)
    : { data: [] as { group_id: string; last_read_at: string }[] };
  const lastReadByGroup = new Map((reads ?? []).map((r) => [r.group_id, r.last_read_at]));

  const { data: messages } = groupIds.length
    ? await supabase
        .from("messages")
        .select("channel_id, body, created_at")
        .eq("channel_type", "meal")
        .in("channel_id", groupIds)
        .order("created_at", { ascending: true })
    : { data: [] as { channel_id: string; body: string; created_at: string }[] };

  const rows: Row[] = groups
    .map((g) => {
      const msgs = (messages ?? []).filter((m) => m.channel_id === g.id);
      const last = msgs[msgs.length - 1];
      const lastReadAt = lastReadByGroup.get(g.id);
      const unread = lastReadAt
        ? msgs.filter((m) => new Date(m.created_at).getTime() > new Date(lastReadAt).getTime()).length
        : msgs.length;
      return {
        groupId: g.id,
        name: g.name,
        lastBody: last?.body ?? "No messages yet.",
        lastAt: last?.created_at ?? null,
        unread,
      };
    })
    .sort((a, b) => new Date(b.lastAt ?? 0).getTime() - new Date(a.lastAt ?? 0).getTime());

  return (
    <section style={{ padding: "24px 20px" }}>
      <header className="page-head">
        <p className="page-kicker">{conference?.name ?? "Icebreaker"}</p>
        <h1 className="page-title">Chat</h1>
        <p className="page-sub">Every table and ride you&apos;re part of.</p>
      </header>

      {rows.length === 0 ? (
        <p style={{ color: "var(--ink-2)", fontSize: 15, paddingTop: 8 }}>
          No conversations yet — join a dinner or ride to start one.
        </p>
      ) : (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line)" }}>
          {rows.map((r) => (
            <Link
              key={r.groupId}
              href={`/groups/${r.groupId}/chat`}
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
                {r.unread > 0 && (
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
    </section>
  );
}
