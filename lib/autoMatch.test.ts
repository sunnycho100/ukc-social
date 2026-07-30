import { describe, it, expect } from "vitest";
import { shouldAutoMatch } from "./autoMatch";
import type { Conference } from "./conference";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const baseConference = (overrides: Partial<Conference> = {}): Conference => ({
  id: "c1",
  name: "Test Conference",
  location: "",
  starts_at: new Date("2026-08-05T00:00:00Z").toISOString(),
  ends_at: new Date("2026-08-08T00:00:00Z").toISOString(),
  timezone: "America/New_York",
  utc_offset: "-04:00",
  airport_code: "MCO",
  auto_matching_enabled: true,
  matching_interval_minutes: 360,
  last_auto_match_at: null,
  ...overrides,
});

describe("shouldAutoMatch", () => {
  it("is false with no conference registered", () => {
    expect(shouldAutoMatch(null, new Date("2026-08-01T00:00:00Z"))).toBe(false);
  });

  it("is false when auto_matching_enabled is off", () => {
    const c = baseConference({ auto_matching_enabled: false });
    expect(shouldAutoMatch(c, new Date("2026-08-05T00:00:00Z"))).toBe(false);
  });

  it("is false more than 7 days before starts_at", () => {
    const c = baseConference();
    const now = new Date(new Date(c.starts_at).getTime() - 8 * DAY_MS);
    expect(shouldAutoMatch(c, now)).toBe(false);
  });

  it("is true exactly at the 7-day-before boundary", () => {
    const c = baseConference();
    const now = new Date(new Date(c.starts_at).getTime() - 7 * DAY_MS);
    expect(shouldAutoMatch(c, now)).toBe(true);
  });

  it("is true when never run yet and inside the window", () => {
    const c = baseConference();
    const now = new Date(new Date(c.starts_at).getTime() - 1 * DAY_MS);
    expect(shouldAutoMatch(c, now)).toBe(true);
  });

  it("is false if the interval hasn't elapsed since the last run", () => {
    const now = new Date("2026-08-06T12:00:00Z");
    const c = baseConference({
      matching_interval_minutes: 360,
      last_auto_match_at: new Date(now.getTime() - 2 * HOUR_MS).toISOString(),
    });
    expect(shouldAutoMatch(c, now)).toBe(false);
  });

  it("is true once the interval has elapsed since the last run", () => {
    const now = new Date("2026-08-06T12:00:00Z");
    const c = baseConference({
      matching_interval_minutes: 360,
      last_auto_match_at: new Date(now.getTime() - 7 * HOUR_MS).toISOString(),
    });
    expect(shouldAutoMatch(c, now)).toBe(true);
  });

  it("is false once the conference has ended", () => {
    const c = baseConference();
    const now = new Date(new Date(c.ends_at).getTime() + 1 * HOUR_MS);
    expect(shouldAutoMatch(c, now)).toBe(false);
  });

  it("is true exactly at ends_at (inclusive upper boundary)", () => {
    const c = baseConference();
    expect(shouldAutoMatch(c, new Date(c.ends_at))).toBe(true);
  });

  it("is true exactly when the interval has just elapsed (inclusive boundary)", () => {
    const now = new Date("2026-08-06T12:00:00Z");
    const c = baseConference({
      matching_interval_minutes: 360,
      last_auto_match_at: new Date(now.getTime() - 360 * 60_000).toISOString(),
    });
    expect(shouldAutoMatch(c, now)).toBe(true);
  });
});
