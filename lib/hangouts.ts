// Hangouts are ride_pools rows with direction 'hangout' (migration 0030): a
// group leaving the hotel for somewhere, browsable and joinable, as opposed to
// the arrival/departure pools the matcher builds for you out of flight times.
//
// Plain module, no "use server", so the board and the server actions share one
// set of rules and the rules are testable without a database.

export type HangoutMember = {
  id: string;
  name: string;
  photo_url: string | null;
  // "" unless profiles.p_sel let the caller read it, which since 0023 means
  // they share a channel with this person. Being in the same hangout is one.
  kakao: string;
};

export type Hangout = {
  id: string;
  title: string;
  leaveAt: string; // ISO
  meetPoint: string;
  capacity: number;
  members: HangoutMember[];
};

export const DEFAULT_SEATS = 4;
export const MIN_SEATS = 2;
export const MAX_SEATS = 12;

// Seats come off a number input, so they arrive as whatever the user typed.
// Floor rather than round: asking for 4.9 seats gets you 4, never a seat that
// is not there.
export function clampSeats(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SEATS;
  return Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.floor(n)));
}

// Once the group has left, the row is history: the board drops it instead of
// offering a join nobody can use. Compared as instants, not calendar days, so
// a hangout still counts this morning and stops counting this afternoon.
export function isUpcoming(leaveAt: string, nowIso: string): boolean {
  return new Date(leaveAt).getTime() > new Date(nowIso).getTime();
}
