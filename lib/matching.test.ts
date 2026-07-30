import { describe, it, expect } from "vitest";
import {
  validateAssignment,
  roundRobinGroups,
  buildMatchPrompt,
  repackInvalid,
  ROUND_ROBIN_RATIONALE,
  type SignupProfile,
  type MatchGroup,
} from "./matching";

const ids = (n: number) => Array.from({length: n}, (_, i) => `u${i}`);

// Build signup profiles from a list of party sizes: sizes[i] is user u{i}'s headcount.
const parties = (sizes: number[]): SignupProfile[] =>
  sizes.map((size, i) => ({ userId: `u${i}`, name: `u${i}`, school: "",
    position: "", interests: [], partySize: size }));

const sizeMap = (sizes: number[]) =>
  new Map(sizes.map((s, i) => [`u${i}`, s]));

const headcount = (memberIds: string[], sizes: Map<string, number>) =>
  memberIds.reduce((n, id) => n + (sizes.get(id) ?? 1), 0);

describe("validateAssignment", () => {
  it("passes a clean partition", () => {
    const r = validateAssignment(ids(10),
      [{memberIds: ids(10).slice(0,5)}, {memberIds: ids(10).slice(5)}]);
    expect(r.ok).toBe(true);
  });
  it("catches missing and duplicated users", () => {
    const r = validateAssignment(ids(10),
      [{memberIds: ["u0","u1","u2","u3","u0"]}, {memberIds: ["u5","u6","u7","u8"]}]);
    expect(r.ok).toBe(false);
    expect(r.dupes).toContain("u0");
    expect(r.missing).toContain("u4");
    expect(r.missing).toContain("u9");
  });
  it("flags oversize groups", () => {
    const r = validateAssignment(ids(7), [{memberIds: ids(7)}]);
    expect(r.ok).toBe(false);
    expect(r.oversize).toEqual([0]);
  });
  it("flags unknown ids not in the signup list", () => {
    const r = validateAssignment(ids(5), [{memberIds: [...ids(5), "ghost"]}]);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("ghost");
  });
});

describe("roundRobinGroups", () => {
  const profiles = ids(13).map(id => ({ userId: id, name: id, school: "",
    position: "", interests: [] }));
  it("partitions everyone exactly once within size bounds", () => {
    const gs = roundRobinGroups(profiles);
    const all = gs.flatMap(g => g.memberIds).sort();
    expect(all).toEqual(ids(13).sort());
    for (const g of gs) {
      expect(g.memberIds.length).toBeGreaterThanOrEqual(4);
      expect(g.memberIds.length).toBeLessThanOrEqual(6);
    }
  });
  it("handles n<min as one flex group", () => {
    const gs = roundRobinGroups(profiles.slice(0, 3));
    expect(gs.length).toBe(1);
    expect(gs[0].memberIds.length).toBe(3);
  });
  it("handles n=0 without crashing", () => {
    const gs = roundRobinGroups([]);
    expect(gs.length).toBe(1);
    expect(gs[0].memberIds).toEqual([]);
  });
});

describe("roundRobinGroups — party headcount", () => {
  it("seats a pair and a trio at one table of 5", () => {
    const sizes = [3, 2];
    const gs = roundRobinGroups(parties(sizes));
    expect(gs.length).toBe(1);
    expect(gs[0].memberIds.sort()).toEqual(["u0", "u1"]);
    expect(headcount(gs[0].memberIds, sizeMap(sizes))).toBe(5);
  });

  it("packs two trios without exceeding max headcount", () => {
    const sizes = [3, 3];
    const gs = roundRobinGroups(parties(sizes));
    const sm = sizeMap(sizes);
    for (const g of gs) expect(headcount(g.memberIds, sm)).toBeLessThanOrEqual(6);
    // both trios placed, everyone once
    expect(gs.flatMap((g) => g.memberIds).sort()).toEqual(["u0", "u1"]);
  });

  it("keeps two parties of 4 at separate tables (8 > max)", () => {
    const sizes = [4, 4];
    const gs = roundRobinGroups(parties(sizes));
    const sm = sizeMap(sizes);
    expect(gs.length).toBe(2);
    for (const g of gs) expect(headcount(g.memberIds, sm)).toBe(4);
  });

  it("gives a full party of 6 its own table", () => {
    const sizes = [6];
    const gs = roundRobinGroups(parties(sizes));
    expect(gs.length).toBe(1);
    expect(headcount(gs[0].memberIds, sizeMap(sizes))).toBe(6);
  });

  it("balances 7 solo diners into 4+3, not a lone diner (6+1)", () => {
    const sizes = Array(7).fill(1);
    const gs = roundRobinGroups(parties(sizes));
    const sm = sizeMap(sizes);
    expect(gs.length).toBe(2);
    for (const g of gs) {
      const h = headcount(g.memberIds, sm);
      expect(h).toBeLessThanOrEqual(6);
      expect(h).toBeGreaterThanOrEqual(3); // no lone diner
    }
  });

  it("seats a lone party bigger than max alone, without leaving stray empty bins", () => {
    // A party of 7 can't fit under max=6 with anyone else, and can't be split
    // (atoms are never split) — it must still get exactly one non-empty group,
    // with none of the pre-allocated empty bins leaking through as phantom
    // zero-member tables (which would otherwise get inserted into the DB as a
    // broken, member-less group row).
    const sizes = [7];
    const gs = roundRobinGroups(parties(sizes));
    expect(gs.length).toBe(1);
    expect(gs[0].memberIds).toEqual(["u0"]);
    expect(headcount(gs[0].memberIds, sizeMap(sizes))).toBe(7);
  });

  it("gives each of two lone oversized parties its own group, no phantom empties", () => {
    const sizes = [7, 8];
    const gs = roundRobinGroups(parties(sizes));
    expect(gs.length).toBe(2);
    expect(gs.every((g) => g.memberIds.length > 0)).toBe(true);
    const all = gs.flatMap((g) => g.memberIds).sort();
    expect(all).toEqual(["u0", "u1"]);
  });

  it("never exceeds max headcount and seats everyone exactly once (mixed)", () => {
    const sizes = [1, 2, 3, 4, 1, 2, 3, 1, 2, 5, 1];
    const gs = roundRobinGroups(parties(sizes));
    const sm = sizeMap(sizes);
    const all = gs.flatMap((g) => g.memberIds).sort();
    expect(all).toEqual(ids(sizes.length).sort());
    for (const g of gs) expect(headcount(g.memberIds, sm)).toBeLessThanOrEqual(6);
    // no atom split: every id appears exactly once (already covered by all==ids, no dupes)
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("buildMatchPrompt", () => {
  it("interpolates eventName when given", () => {
    const p = buildMatchPrompt([], { min: 4, max: 6, eventName: "KSEA 2026" });
    expect(p).toContain("KSEA 2026 attendees");
  });
  it("falls back to generic phrasing when eventName is omitted", () => {
    const p = buildMatchPrompt([], { min: 4, max: 6 });
    expect(p).toContain("conference attendees");
  });
  it("asks for an icebreaker question, not a suggested place/cuisine", () => {
    // Regression guard: an earlier version asked for "a suggested cuisine
    // near X" — pure LLM invention with no real venue data behind it, and
    // prone to nonsensical results. Where to meet is left to the group now.
    const p = buildMatchPrompt([], { min: 4, max: 6 });
    expect(p).toContain("icebreaker question");
    expect(p.toLowerCase()).not.toContain("cuisine");
    expect(p.toLowerCase()).not.toContain("suggested place");
  });
  it("embeds the min/max seat bounds and the roster JSON", () => {
    const roster = [{ userId: "u0" }];
    const p = buildMatchPrompt(roster, { min: 4, max: 6 });
    expect(p).toContain("4-6 people TOTAL");
    expect(p).toContain(JSON.stringify(roster, null, 1));
  });
});

describe("repackInvalid", () => {
  it("returns the groups unchanged when the assignment is already valid", () => {
    const sizes = [3, 3];
    const signups = parties(sizes);
    const groups: MatchGroup[] = [{ memberIds: ["u0", "u1"], name: "Table 1",
      rationale: "warm llm rationale", starterQuestion: "" }];
    const out = repackInvalid(groups, ids(2), signups, 4, 6, sizeMap(sizes));
    expect(out).toBe(groups); // same reference — no repack work done
  });

  it("keeps the valid groups and only re-packs the oversize ones", () => {
    // Table 0 is a clean 4-person table (valid); Table 1 wrongly crams two
    // 3-person parties together for 6+... actually make it truly oversize: a
    // party of 4 + a party of 4 in one table = headcount 8 > max 6.
    const sizes = [4, 4, 2, 2]; // u0,u1 oversized together; u2,u3 fine together
    const signups = parties(sizes);
    const badGroups: MatchGroup[] = [
      { memberIds: ["u0", "u1"], name: "Table 1", rationale: "llm rationale", starterQuestion: "" },
      { memberIds: ["u2", "u3"], name: "Table 2", rationale: "llm rationale", starterQuestion: "" },
    ];
    const out = repackInvalid(badGroups, ids(4), signups, 4, 6, sizeMap(sizes));
    // The valid table (u2,u3) survives untouched, by reference.
    expect(out).toContain(badGroups[1]);
    // Everyone is still seated exactly once, and the repacked remainder is valid.
    const all = out.flatMap((g) => g.memberIds).sort();
    expect(all).toEqual(["u0", "u1", "u2", "u3"]);
    const revalidated = validateAssignment(ids(4), out, 4, 6, sizeMap(sizes));
    expect(revalidated.oversize).toEqual([]);
  });

  it("falls back to a full repack when the partition itself is broken (missing/duped ids)", () => {
    const sizes = [1, 1, 1, 1];
    const signups = parties(sizes);
    // u3 is missing entirely from this "LLM" output — not a clean partition,
    // so repackInvalid can't trust any individual group's membership.
    const brokenGroups: MatchGroup[] = [
      { memberIds: ["u0", "u1", "u2"], name: "Table 1", rationale: "llm rationale", starterQuestion: "" },
    ];
    const out = repackInvalid(brokenGroups, ids(4), signups, 4, 6, sizeMap(sizes));
    const all = out.flatMap((g) => g.memberIds).sort();
    expect(all).toEqual(ids(4).sort()); // everyone present now, including u3
    expect(out.every((g) => g.rationale === ROUND_ROBIN_RATIONALE)).toBe(true);
  });

  it("is idempotent (not an infinite loop) for a lone party bigger than max", () => {
    const sizes = [7];
    const signups = parties(sizes);
    const groups: MatchGroup[] = [{ memberIds: ["u0"], name: "Table 1", rationale: "llm rationale", starterQuestion: "" }];
    const out = repackInvalid(groups, ["u0"], signups, 4, 6, sizeMap(sizes));
    expect(out.length).toBe(1);
    expect(out[0].memberIds).toEqual(["u0"]);
  });
});

describe("validateAssignment — unavoidable oversize (indivisible party > max)", () => {
  it("flags an unavoidable oversized table as not-ok, even though it's the only possible grouping", () => {
    // Documents an existing gap, not a new fix: roundRobinGroups() will still
    // produce (and app/actions/admin.ts's matchOneSlot will still insert) this
    // exact table, since parties can never be split. validateAssignment's
    // "oversize is a hard fail" is informational here, not enforced upstream —
    // there's no retry/split path for an indivisible party bigger than max.
    const sizes = new Map([["a", 7]]);
    const r = validateAssignment(["a"], [{ memberIds: ["a"] }], 4, 6, sizes);
    expect(r.ok).toBe(false);
    expect(r.oversize).toEqual([0]);
  });
});

describe("validateAssignment — by headcount", () => {
  it("accepts a table whose member-count is 2 but headcount is 5", () => {
    const sizes = new Map([["a", 3], ["b", 2]]);
    const r = validateAssignment(["a", "b"], [{ memberIds: ["a", "b"] }], 4, 6, sizes);
    expect(r.ok).toBe(true);
  });
  it("flags a table oversized by headcount even with few members", () => {
    const sizes = new Map([["a", 3], ["b", 3], ["c", 2]]);
    const r = validateAssignment(["a", "b", "c"], [{ memberIds: ["a", "b", "c"] }], 4, 6, sizes);
    expect(r.ok).toBe(false);
    expect(r.oversize).toEqual([0]);
  });
});
