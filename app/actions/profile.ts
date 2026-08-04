"use server";

import { createServerSupabase } from "@/lib/supabase/server";

type ProfileInput = Partial<{
  event_id: string | null;
  stay_start: string | null;
  stay_end: string | null;
  name: string;
  school: string;
  position: string;
  birthday: string | null;
  interests: string[];
  bio: string;
  kakao: string;
  linkedin: string;
  instagram: string;
  dietary: string;
  photo_url: string;
  dinners_wanted: string[];
}>;

type Result = { ok: boolean; error?: string };

export async function saveProfile(fields: ProfileInput): Promise<Result> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, ...fields });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Reconcile the current user's meal signups to exactly `slotIds`.
export async function setDinnerSignups(slotIds: string[]): Promise<Result> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // Restrict to kind='meal' so ride signups (if any) are untouched.
  const { data: mealSlots, error: slotsErr } = await supabase
    .from("slots")
    .select("id, join_deadline")
    .eq("kind", "meal");
  if (slotsErr) return { ok: false, error: slotsErr.message };

  // A dinner past its deadline is settled: its tables may already be seated
  // and shown to the people at them. joinSlot has always refused a closed
  // slot, but this path never checked, so onboarding could put someone into a
  // dinner that had already been matched and revealed.
  const now = Date.now();
  const isOpen = new Map(
    (mealSlots ?? []).map((s) => [
      s.id as string,
      new Date(s.join_deadline as string).getTime() > now,
    ]),
  );
  const open = slotIds.filter((id) => isOpen.get(id) !== false);

  if (open.length) {
    const { error } = await supabase
      .from("signups")
      .upsert(
        open.map((slot_id) => ({ slot_id, user_id: user.id })),
        { onConflict: "slot_id,user_id", ignoreDuplicates: true },
      );
    if (error) return { ok: false, error: error.message };
  }

  // Unchecking only removes a signup while the dinner is still open, for the
  // same reason: dropping someone out of a table that has already been
  // revealed would leave the others looking at a seat that no longer exists.
  const toDelete = (mealSlots ?? [])
    .map((s) => s.id as string)
    .filter((id) => !slotIds.includes(id) && isOpen.get(id) !== false);
  if (toDelete.length) {
    const { error } = await supabase
      .from("signups")
      .delete()
      .eq("user_id", user.id)
      .in("slot_id", toDelete);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}
