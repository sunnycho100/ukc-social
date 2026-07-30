// Hard schedule filter: interest fit must never override a schedule conflict.
// Used both by matchOneSlot (app/actions/admin.ts, a backstop even if a join
// somehow slipped through) and joinSlot (app/actions/signups.ts, the
// front-line check at join time).

export type ScheduleProfile = {
  event_id: string | null | undefined;
  stay_start: string | null | undefined;
  stay_end: string | null | undefined;
};

// `slotDate` is compared as a plain "YYYY-MM-DD" (or any ISO string — only the
// date portion before "T" is used) against stay_start/stay_end, which are
// already date-only columns (see migration 0009).
export function isEligibleForSlot(profile: ScheduleProfile, slotStartsAt: string): boolean {
  // No event_id = picked "None of these" (or hasn't onboarded) — just exploring,
  // not actually attending, so never eligible for a real slot.
  if (!profile.event_id) return false;

  // Missing stay dates is ambiguous (nothing to compare against) — don't block
  // on data we don't have.
  if (!profile.stay_start || !profile.stay_end) return true;

  const slotDate = slotStartsAt.slice(0, 10);
  return profile.stay_start <= slotDate && slotDate <= profile.stay_end;
}
