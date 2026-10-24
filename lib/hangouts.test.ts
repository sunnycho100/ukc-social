import { describe, it, expect } from "vitest";
import { clampSeats, isUpcoming, DEFAULT_SEATS, MIN_SEATS, MAX_SEATS } from "./hangouts";

describe("clampSeats", () => {
  it("keeps a sane number", () => {
    expect(clampSeats(6)).toBe(6);
  });

  it("pins to the ends of the range", () => {
    expect(clampSeats(1)).toBe(MIN_SEATS);
    expect(clampSeats(99)).toBe(MAX_SEATS);
  });

  it("never invents a seat that is not there", () => {
    expect(clampSeats(4.9)).toBe(4);
  });

  it("falls back when the input is not a number", () => {
    expect(clampSeats(NaN)).toBe(DEFAULT_SEATS);
  });
});

describe("isUpcoming", () => {
  it("is true before the group leaves", () => {
    expect(isUpcoming("2026-08-06T18:00:00Z", "2026-08-06T17:59:00Z")).toBe(true);
  });

  it("is false once it has left, same day", () => {
    expect(isUpcoming("2026-08-06T18:00:00Z", "2026-08-06T18:01:00Z")).toBe(false);
  });
});
