"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";

type Result = { ok: boolean; error?: string };

export type ConferenceInput = {
  id?: string;
  name: string;
  location: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  utc_offset: string;
  airport_code: string;
  auto_matching_enabled: boolean;
  matching_interval_minutes: number;
};

// Registers (or edits, if `id` is passed) the deployment's conference. One
// deployment/fork = one conference in practice, so this is an upsert-by-id
// rather than an always-insert, keeping it a de-facto singleton without a
// DB-level constraint.
export async function upsertConference(fields: ConferenceInput): Promise<Result> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== process.env.ADMIN_EMAIL) return { ok: false, error: "forbidden" };

  if (!fields.name.trim()) return { ok: false, error: "Name is required." };
  if (new Date(fields.starts_at) >= new Date(fields.ends_at))
    return { ok: false, error: "Start date must be before end date." };
  if (!Number.isFinite(fields.matching_interval_minutes) || fields.matching_interval_minutes <= 0)
    return { ok: false, error: "Matching interval must be a positive number of minutes." };

  const svc = serviceClient();
  const { id, ...rest } = fields;
  const { error } = id
    ? await svc.from("conferences").update(rest).eq("id", id)
    : await svc.from("conferences").insert(rest);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
