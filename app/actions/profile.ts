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

  if (slotIds.length) {
    const { error } = await supabase
      .from("signups")
      .upsert(
        slotIds.map((slot_id) => ({ slot_id, user_id: user.id })),
        { onConflict: "slot_id,user_id", ignoreDuplicates: true },
      );
    if (error) return { ok: false, error: error.message };
  }

  // Remove meal signups the user unchecked. Restrict to kind='meal' so ride
  // signups (if any) are untouched.
  const { data: mealSlots, error: slotsErr } = await supabase
    .from("slots")
    .select("id")
    .eq("kind", "meal");
  if (slotsErr) return { ok: false, error: slotsErr.message };

  const toDelete = (mealSlots ?? [])
    .map((s) => s.id as string)
    .filter((id) => !slotIds.includes(id));
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
