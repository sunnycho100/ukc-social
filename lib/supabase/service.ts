import { createClient } from "@supabase/supabase-js";

// Service-role client for privileged server-side writes (bypasses RLS).
// Server-only — never expose SUPABASE_SERVICE_ROLE_KEY as NEXT_PUBLIC_*.
export function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
