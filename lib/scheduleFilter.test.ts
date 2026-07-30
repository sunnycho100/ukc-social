import { describe, it, expect } from "vitest";
import { isEligibleForSlot, type ScheduleProfile } from "./scheduleFilter";

const attending = (over: Partial<ScheduleProfile> = {}): ScheduleProfile => ({
  event_id: "conf-1",
  stay_start: "2026-08-05",
  stay_end: "2026-08-08",
  ...over,
});

describe("isEligibleForSlot", () => {
  it("is false when event_id is null (picked \"None of these\")", () => {
    expect(isEligibleForSlot(attending({ event_id: null }), "2026-08-06T19:00:00Z")).toBe(false);
  });

  it("is true when stay dates are unset — ambiguous, don't block on missing data", () => {
    expect(
      isEligibleForSlot(attending({ stay_start: null, stay_end: null }), "2026-08-06T19:00:00Z"),
    ).toBe(true);
    expect(
      isEligibleForSlot(attending({ stay_start: "2026-08-05", stay_end: undefined }), "2026-08-06T19:00:00Z"),
    ).toBe(true);
  });

  it("is true when the slot's date falls inside the stay window", () => {
    expect(isEligibleForSlot(attending(), "2026-08-06T19:00:00Z")).toBe(true);
  });

  it("is true at the inclusive boundaries (check-in day and check-out day)", () => {
    expect(isEligibleForSlot(attending(), "2026-08-05T19:00:00Z")).toBe(true);
    expect(isEligibleForSlot(attending(), "2026-08-08T19:00:00Z")).toBe(true);
  });

  it("is false when the slot is before check-in or after check-out", () => {
    expect(isEligibleForSlot(attending(), "2026-08-04T19:00:00Z")).toBe(false);
    expect(isEligibleForSlot(attending(), "2026-08-09T19:00:00Z")).toBe(false);
  });
});
