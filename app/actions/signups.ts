"use server";

import { requireUser } from "@/lib/supabase/server";
import { isEligibleForSlot } from "@/lib/scheduleFilter";

type Result = { ok: boolean; error?: string };

export async function joinSlot(
  slotId: string,
  opts: { partySize?: number; notes?: string; confirmed?: boolean },
): Promise<Result> {
  const { user, supabase } = await requireUser();

  const { data: slot } = await supabase
    .from("slots")
    .select("join_deadline, starts_at")
    .eq("id", slotId)
    .single();
  if (!slot) return { ok: false, error: "not_found" };
  if (new Date(slot.join_deadline).getTime() <= Date.now()) {
    return { ok: false, error: "closed" };
  }

  // Front-line schedule check: someone whose stay doesn't cover this slot's
  // date gets a warning, not a silent join — matchOneSlot (app/actions/admin.ts)
  // enforces the same rule as a backstop even if this is somehow bypassed.
  if (!opts.confirmed) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("event_id, stay_start, stay_end")
      .eq("id", user.id)
      .maybeSingle();
    if (profile && !isEligibleForSlot(profile, slot.starts_at)) {
      return { ok: false, error: "schedule_conflict" };
    }
  }

  // Clamp to the DB check (1-6); default solo.
  const partySize = Math.min(6, Math.max(1, Math.round(opts.partySize ?? 1)));
  const { error } = await supabase.from("signups").upsert(
    {
      slot_id: slotId,
      user_id: user.id,
      party_size: partySize,
      notes: opts.notes ?? "",
    },
    { onConflict: "slot_id,user_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function leaveSlot(slotId: string): Promise<Result> {
  const { user, supabase } = await requireUser();
  const { error } = await supabase
    .from("signups")
    .delete()
    .eq("slot_id", slotId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
