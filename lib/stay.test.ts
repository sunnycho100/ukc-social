import { describe, it, expect } from "vitest";
import { stayRelation } from "./stay";

const viewer = { start: "2026-08-05", end: "2026-08-08" };

describe("stayRelation", () => {
  it("returns null when either side's dates are unset", () => {
    expect(stayRelation({ start: null, end: null }, viewer)).toBeNull();
    expect(stayRelation({ start: "2026-08-05", end: "2026-08-08" }, { start: null, end: null })).toBeNull();
  });

  it("flags no-overlap when the ranges don't touch", () => {
    expect(stayRelation({ start: "2026-08-01", end: "2026-08-03" }, viewer)).toBe("no-overlap");
  });

  it("flags early when the person's stay starts before the viewer's", () => {
    expect(stayRelation({ start: "2026-08-03", end: "2026-08-08" }, viewer)).toBe("early");
  });

  it("flags late when the person's stay ends after the viewer's", () => {
    expect(stayRelation({ start: "2026-08-05", end: "2026-08-10" }, viewer)).toBe("late");
  });

  it("flags same when the person's stay is within the viewer's window", () => {
    expect(stayRelation({ start: "2026-08-05", end: "2026-08-08" }, viewer)).toBe("same");
    expect(stayRelation({ start: "2026-08-06", end: "2026-08-07" }, viewer)).toBe("same");
  });

  it("returns null when only one field on either side is unset (partial dates)", () => {
    expect(stayRelation({ start: "2026-08-05", end: null }, viewer)).toBeNull();
    expect(stayRelation({ start: null, end: "2026-08-08" }, viewer)).toBeNull();
    expect(stayRelation(viewer, { start: "2026-08-05", end: undefined })).toBeNull();
  });

  it("prioritizes early over late when the person bookends the viewer's whole stay", () => {
    // Person arrives before AND leaves after the viewer — only one label can be
    // returned, and "early" wins because it's checked first. This documents the
    // current precedence rather than asserting it's the only sensible choice.
    expect(stayRelation({ start: "2026-08-03", end: "2026-08-10" }, viewer)).toBe("early");
  });

  it("treats a single touching day as overlap, not no-overlap", () => {
    // Person's stay ends exactly on the viewer's arrival day.
    expect(stayRelation({ start: "2026-08-01", end: "2026-08-05" }, viewer)).toBe("early");
    // Person's stay starts exactly on the viewer's departure day.
    expect(stayRelation({ start: "2026-08-08", end: "2026-08-12" }, viewer)).toBe("late");
  });

  it("compares correctly across a month boundary (string comparison stays valid)", () => {
    const augViewer = { start: "2026-08-28", end: "2026-09-02" };
    expect(stayRelation({ start: "2026-08-30", end: "2026-09-01" }, augViewer)).toBe("same");
    expect(stayRelation({ start: "2026-09-05", end: "2026-09-08" }, augViewer)).toBe("no-overlap");
  });
});
