import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import AdminSlotRow from "@/components/AdminSlotRow";

export default async function AdminPage() {
  const { user, supabase } = await requireUser();
  if (user.email !== process.env.ADMIN_EMAIL) notFound();

  const { data: slots } = await supabase
    .from("slots")
    .select("id, title, starts_at")
    .order("starts_at");
  const { data: signups } = await supabase.from("signups").select("slot_id");
  // Which slots already have groups: without this every row looks like a first
  // run, and a destructive re-run is indistinguishable from a safe one.
  const { data: groupRows } = await supabase.from("groups").select("slot_id");

  const counts = new Map<string, number>();
  for (const s of signups ?? [])
    counts.set(s.slot_id as string, (counts.get(s.slot_id as string) ?? 0) + 1);

  const groupCounts = new Map<string, number>();
  for (const g of groupRows ?? [])
    groupCounts.set(g.slot_id as string, (groupCounts.get(g.slot_id as string) ?? 0) + 1);

  return (
    <section style={{ padding: "24px 20px", maxWidth: 640, margin: "0 auto" }}>
      <header className="page-head">
        <p className="page-kicker">Admin</p>
        <h1 className="page-title">Matching</h1>
        <p className="page-sub">
          Run interest matching per slot. Re-running replaces the existing groups and
          leaves their chats unreachable.
        </p>
      </header>
      <div style={{ borderTop: "1px solid var(--line)" }}>
        {(slots ?? []).map((slot) => (
          <AdminSlotRow
            key={slot.id as string}
            slotId={slot.id as string}
            title={slot.title as string}
            count={counts.get(slot.id as string) ?? 0}
            groupCount={groupCounts.get(slot.id as string) ?? 0}
          />
        ))}
        {!slots?.length && (
          <p style={{ color: "var(--ink-3)", padding: "16px 0" }}>No slots yet.</p>
        )}
      </div>
    </section>
  );
}
