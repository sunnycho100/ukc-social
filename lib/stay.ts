// Pure helper comparing two stay windows (ISO "YYYY-MM-DD" date strings, or
// null/unset). Used by the People directory to show "Arriving early" /
// "Staying late" / "Here the same dates as you" relative to the viewer.

export type StayWindow = { start: string | null | undefined; end: string | null | undefined };

export type StayRelation = "early" | "late" | "same" | "no-overlap" | null;

// null = one side's dates are unset — nothing to compare, badge stays hidden.
export function stayRelation(person: StayWindow, viewer: StayWindow): StayRelation {
  if (!person.start || !person.end || !viewer.start || !viewer.end) return null;
  const overlaps = person.start <= viewer.end && person.end >= viewer.start;
  if (!overlaps) return "no-overlap";
  if (person.start < viewer.start) return "early";
  if (person.end > viewer.end) return "late";
  return "same";
}

export const STAY_LABEL: Record<Exclude<StayRelation, null>, string> = {
  early: "Arriving early",
  late: "Staying late",
  same: "Here the same dates as you",
  "no-overlap": "Not here while you are",
};
