import type { SupabaseClient } from "@supabase/supabase-js";

export type Conference = {
  id: string;
  name: string;
  location: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  utc_offset: string;
  airport_code: string;
  auto_matching_enabled: boolean;
  matching_interval_minutes: number;
  last_auto_match_at: string | null;
};

const COLUMNS =
  "id, name, location, starts_at, ends_at, timezone, utc_offset, airport_code, auto_matching_enabled, matching_interval_minutes, last_auto_match_at";

// One deployment/fork = one conference in practice, so this is the most
// recently registered row rather than a hard singleton constraint — lets
// admin "re-register" without a migration if they ever needed to.
export async function getConference(
  supabase: SupabaseClient,
): Promise<Conference | null> {
  const { data } = await supabase
    .from("conferences")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Conference | null) ?? null;
}
