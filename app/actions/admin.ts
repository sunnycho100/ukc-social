"use server";

import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  matchSlot,
  roundRobinGroups,
  validateAssignment,
  type SignupProfile,
  type MatchGroup,
} from "@/lib/matching";
import { nameGroups } from "@/lib/groupName";

type Result = {
  ok: boolean;
  groups?: number;
  flex?: boolean;
  // Which engine actually ran. Without this a silent fallback to round-robin is
  // indistinguishable from real interest matching on a page titled "Matching".
  strategy?: "interest" | "fallback";
  note?: string;
  error?: string;
};

// Admin-legible failures. The raw Postgres text is logged, never rendered: it
// never tells the operator whether the prior groups survived, which is the only
// thing they need to know before retrying.
function fail(stage: string, err: unknown, message: string): Result {
  console.error(`runMatching failed at ${stage}`, err);
  return { ok: false, error: message };
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function runMatching(slotId: string): Promise<Result> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== process.env.ADMIN_EMAIL)
    return { ok: false, error: "forbidden" };

  const svc = serviceClient();

  const { data: slot, error: slotErr } = await svc
    .from("slots")
    .select("id, starts_at")
    .eq("id", slotId)
    .single();
  if (slotErr || !slot)
    return fail("load slot", slotErr, "Couldn't load that slot. Nothing changed.");

  const { data: rows, error: sErr } = await svc
    .from("signups")
    .select("user_id, party_size, notes, profiles(name, school, position, interests)")
    .eq("slot_id", slotId);
  if (sErr) return fail("load signups", sErr, "Couldn't load signups. Nothing changed.");

  const signups: SignupProfile[] = (rows ?? []).map((r) => {
    // supabase types the joined relation as an array; it's a single row here.
    const p = (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) ?? {};
    return {
      userId: r.user_id as string,
      name: (p.name as string) ?? "",
      school: (p.school as string) ?? "",
      position: (p.position as string) ?? "",
      interests: (p.interests as string[]) ?? [],
      partySize: (r.party_size as number | null) ?? 1,
      notes: (r.notes as string) ?? "",
    };
  });

  // Returns before the delete below, so any prior groups for this slot survive.
  // Say so: "0 groups" alone reads as "this slot is now empty", which is false.
  if (signups.length === 0)
    return { ok: true, groups: 0, note: "No signups. Any prior groups were left as they were." };

  const sizes = new Map(signups.map((s) => [s.userId, s.partySize ?? 1]));
  const headcount = (ids: string[]) => ids.reduce((n, id) => n + (sizes.get(id) ?? 1), 0);

  let groups: MatchGroup[];
  let strategy: "interest" | "fallback" = "interest";
  try {
    groups = await matchSlot(signups);
  } catch (err) {
    // ponytail: falls back on missing ANTHROPIC_API_KEY
    console.error("matchSlot failed, falling back to round robin", err);
    groups = roundRobinGroups(signups);
    strategy = "fallback";
  }
  // Validate by headcount (a party of 3 weighs 3), matching matchSlot's own check.
  if (!validateAssignment(signups.map((s) => s.userId), groups, 4, 6, sizes).ok) {
    groups = roundRobinGroups(signups);
    strategy = "fallback";
  }

  // Name each table from the identity bank (data/group-names.json), not "Table N".
  // Uses each member's interests + position to pick a fitting playful name, deduped per slot.
  const profileMap = new Map(
    signups.map((s) => [s.userId, { interests: s.interests, position: s.position }]),
  );
  const names = nameGroups(groups, profileMap);

  // Idempotent: wipe prior groups for this slot (cascade drops group_members).
  const { error: delErr } = await svc.from("groups").delete().eq("slot_id", slotId);
  if (delErr) return fail("delete prior groups", delErr, "Couldn't clear the prior groups. Nothing changed.");

  const { data: inserted, error: gErr } = await svc
    .from("groups")
    .insert(
      groups.map((g, i) => ({
        slot_id: slotId,
        name: names[i],
        rationale: g.rationale,
        suggested_place: g.suggestedPlace,
        meet_time: slot.starts_at,
      })),
    )
    .select("id");
  if (gErr || !inserted)
    return fail("insert groups", gErr, "Prior groups were cleared but the new ones failed to save. Re-run this slot.");

  const members = inserted.flatMap((row, i) =>
    groups[i].memberIds.map((user_id) => ({ group_id: row.id as string, user_id })),
  );
  const { error: mErr } = await svc.from("group_members").insert(members);
  if (mErr)
    return fail("insert members", mErr, "Tables were created but seating them failed. Re-run this slot.");

  // Flex = some table seats fewer than 4 by headcount (an unavoidable small table).
  const flex =
    groups.length > 0 && Math.min(...groups.map((g) => headcount(g.memberIds))) < 4;
  return { ok: true, groups: groups.length, flex, strategy };
}
