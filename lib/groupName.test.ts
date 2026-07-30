import { describe, it, expect } from "vitest";
import { nameGroup, nameGroups, type NameableMember } from "./groupName";
import bank from "../data/group-names.json";

const M = (over: Partial<NameableMember>): NameableMember => ({ interests: [], ...over });

describe("nameGroup", () => {
  it("picks a vibe name when a shared interest holds the majority", () => {
    const members = [
      M({ interests: ["climbing", "coffee"] }),
      M({ interests: ["climbing"] }),
      M({ interests: ["gaming"] }),
    ];
    expect(bank.vibe.climbing).toContain(nameGroup(members));
  });

  it("picks a field-category name when a field dominates", () => {
    const members = [
      M({ position: "PhD Student", interests: ["machine learning"] }),
      M({ position: "Software Engineer", interests: ["ai"] }),
      M({ interests: ["data"] }),
    ];
    expect(bank.cs_data).toContain(nameGroup(members));
  });

  it("falls back to a mixed name with no clear identity", () => {
    const members = [M({ interests: ["knitting"] }), M({ interests: ["birdwatching"] })];
    expect(bank.mixed).toContain(nameGroup(members));
  });

  it("never repeats a name within a batch", () => {
    const groups = [
      { memberIds: ["a", "b"] },
      { memberIds: ["c", "d"] },
      { memberIds: ["e", "f"] },
    ];
    const profiles = new Map<string, NameableMember>([
      ["a", M({ interests: ["ai"] })], ["b", M({ interests: ["ml"] })],
      ["c", M({ interests: ["ai"] })], ["d", M({ interests: ["software"] })],
      ["e", M({ interests: ["ai"] })], ["f", M({ interests: ["data"] })],
    ]);
    const names = nameGroups(groups, profiles);
    expect(new Set(names).size).toBe(3); // all three cs_data groups get distinct names
  });

  // BUG FIX regression: Math.ceil(0/2) === 0, and every category's hit-count (also 0 for
  // an empty group) trivially satisfied `hits >= majority` when majority was 0 — an empty
  // group used to get a confident vibe name (e.g. "Send It") with zero members backing it.
  it("does not falsely match a vibe/field for an empty group — falls to mixed", () => {
    expect(bank.mixed).toContain(nameGroup([]));
  });

  it("does not falsely match a vibe/field for a single member with no signal", () => {
    expect(bank.mixed).toContain(nameGroup([M({})]));
  });

  it("still allows a genuine single-member vibe match (n=1, majority=1)", () => {
    // With the majority-floored-at-1 fix, a lone member who *does* carry the
    // interest still earns the vibe name (1 hit >= majority 1) — the fix only
    // guards the zero-signal case, it doesn't require >1 members for a vibe match.
    expect(bank.vibe.coffee).toContain(nameGroup([M({ interests: ["coffee"] })]));
  });

  it("falls through to a field/mixed name once a vibe pool is fully used up in the batch", () => {
    // "startups" has exactly one name in the bank (Founder Mode, see
    // data/group-names.json) — a second group sharing that vibe in the same
    // batch can't reuse it and must fall through to the next tier instead of
    // returning undefined/crashing.
    const startupMembers = () => [M({ interests: ["startups"] }), M({ interests: ["startups"] })];
    const used = new Set<string>();
    const first = nameGroup(startupMembers(), used);
    const second = nameGroup(startupMembers(), used);
    expect(first).toBe("Founder Mode");
    expect(second).not.toBe("Founder Mode");
    expect(typeof second).toBe("string");
    expect(second.length).toBeGreaterThan(0);
  });
});
