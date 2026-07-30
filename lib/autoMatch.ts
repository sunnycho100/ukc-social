import type { Conference } from "./conference";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const AUTO_MATCH_LEAD_DAYS = 7;

// Pure gate for whether the auto-match cron route (app/api/cron/auto-match)
// should actually run matching right now. Kept separate from the route so
// every branch is unit-testable without a live Supabase project.
export function shouldAutoMatch(conference: Conference | null, now: Date): boolean {
  if (!conference) return false;
  if (!conference.auto_matching_enabled) return false;

  const nowMs = now.getTime();
  const windowOpensAt = new Date(conference.starts_at).getTime() - AUTO_MATCH_LEAD_DAYS * DAY_MS;
  if (nowMs < windowOpensAt) return false;
  if (nowMs > new Date(conference.ends_at).getTime()) return false;

  if (conference.last_auto_match_at) {
    const elapsedMs = nowMs - new Date(conference.last_auto_match_at).getTime();
    if (elapsedMs < conference.matching_interval_minutes * MINUTE_MS) return false;
  }

  return true;
}
