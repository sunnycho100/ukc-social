import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { getConference } from "@/lib/conference";
import AdminSlotRow from "@/components/AdminSlotRow";
import AdminConferenceForm from "@/components/AdminConferenceForm";

export default async function AdminPage() {
  const { user, supabase } = await requireUser();
  if (user.email !== process.env.ADMIN_EMAIL) notFound();

  const conference = await getConference(supabase);

  const { data: slots } = await supabase
    .from("slots")
    .select("id, title, starts_at")
    .order("starts_at");
  const { data: signups } = await supabase.from("signups").select("slot_id");

  const counts = new Map<string, number>();
  for (const s of signups ?? [])
    counts.set(s.slot_id as string, (counts.get(s.slot_id as string) ?? 0) + 1);

  return (
    <section style={{ padding: "24px 20px", maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 600 }}>Admin · Matching</h1>
      <p style={{ color: "var(--ink-2)", margin: "8px 0 20px" }}>
        Run interest matching per slot. Reruns replace prior groups.
      </p>

      <AdminConferenceForm conference={conference} />

      <div style={{ borderTop: "1px solid var(--line)" }}>
        {(slots ?? []).map((slot) => (
          <AdminSlotRow
            key={slot.id as string}
            slotId={slot.id as string}
            title={slot.title as string}
            count={counts.get(slot.id as string) ?? 0}
          />
        ))}
        {!slots?.length && (
          <p style={{ color: "var(--ink-3)", padding: "16px 0" }}>No slots yet.</p>
        )}
      </div>
    </section>
  );
}
