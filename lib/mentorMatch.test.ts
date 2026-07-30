import { describe, it, expect } from "vitest";
import {
  type Person,
  classify,
  isMentor,
  jaccard,
  pairType,
  scorePair,
  assignMentees,
  suggestGroups,
  WEIGHTS,
} from "./mentorMatch";

const P = (id: string, role: Person["role"], over: Partial<Person> = {}): Person => ({
  id,
  name: id,
  school: "UW",
  role,
  field: "CS",
  researchArea: "CV",
  interests: [],
  ...over,
});

describe("classify", () => {
  it("phd + industry are mentors; undergrad + masters are mentees", () => {
    expect(classify(P("a", "phd"))).toBe("mentor");
    expect(classify(P("b", "industry"))).toBe("mentor");
    expect(classify(P("c", "masters"))).toBe("mentee");
    expect(classify(P("d", "undergrad"))).toBe("mentee");
    expect(isMentor(P("a", "phd"))).toBe(true);
  });
});

describe("jaccard", () => {
  it("is intersection over union, case-insensitive", () => {
    expect(jaccard(["Startups", "climbing"], ["startups", "hiking"])).toBeCloseTo(1 / 3);
    expect(jaccard(["a"], ["a"])).toBe(1);
    expect(jaccard([], [])).toBe(0); // both empty → 0, not NaN
    expect(jaccard(["a"], ["b"])).toBe(0);
  });

  it("de-dupes repeated tags before computing the union (a duplicate isn't double-counted)", () => {
    // Without de-duping, ["a","a","b"] could inflate the union to 3 instead of 2.
    expect(jaccard(["a", "a", "b"], ["a"])).toBeCloseTo(1 / 2);
  });

  it("ignores blank/whitespace-only tags", () => {
    expect(jaccard(["a", "  ", ""], ["a"])).toBe(1);
  });
});

describe("pairType", () => {
  it("mentorship = one mentor + one mentee; otherwise peer", () => {
    expect(pairType(P("a", "phd"), P("b", "undergrad"))).toBe("mentorship");
    expect(pairType(P("a", "phd"), P("b", "industry"))).toBe("peer");
    expect(pairType(P("a", "masters"), P("b", "undergrad"))).toBe("peer");
  });
});

describe("scorePair", () => {
  it("same field, same research, shared interests, cross-role, cross-school → near 1", () => {
    const a = P("a", "phd", { school: "UW", interests: ["cv", "climbing"] });
    const b = P("b", "undergrad", { school: "MIT", interests: ["cv", "climbing"] });
    const s = scorePair(a, b);
    expect(s.field).toBe(1);
    expect(s.research).toBe(1);
    expect(s.interest).toBe(1);
    expect(s.pairType).toBe("mentorship");
    expect(s.roleFactor).toBe(WEIGHTS.mentorshipRoleFactor);
    expect(s.total).toBeCloseTo(1); // topic 1 * 1.0 + 0.05 crossSchool, capped at 1
  });

  it("same field, different research area → research is the 0.5 partial", () => {
    const a = P("a", "phd", { researchArea: "CV" });
    const b = P("b", "undergrad", { researchArea: "NLP", school: "UW" });
    expect(scorePair(a, b).research).toBe(0.5);
  });

  it("different field → field 0 and research 0", () => {
    const a = P("a", "phd", { field: "CS", researchArea: "CV" });
    const b = P("b", "undergrad", { field: "Biology", researchArea: "Genomics", school: "UW" });
    const s = scorePair(a, b);
    expect(s.field).toBe(0);
    expect(s.research).toBe(0);
    expect(s.total).toBe(0); // no topic, same school → no bonus
  });

  it("peer pairs are discounted by the peer role factor", () => {
    const a = P("a", "phd", { school: "UW", interests: ["cv"] });
    const b = P("b", "industry", { school: "UW", interests: ["cv"] }); // both mentors → peer
    const s = scorePair(a, b);
    expect(s.pairType).toBe("peer");
    expect(s.roleFactor).toBe(WEIGHTS.peerRoleFactor);
    // topic = 1 (same field+research+interest), same school → 1 * 0.7 = 0.7
    expect(s.total).toBeCloseTo(0.7);
  });
});

describe("assignMentees", () => {
  it("assigns every mentee once and never exceeds mentor capacity", () => {
    const people = [
      P("m1", "phd"),
      P("m2", "phd"),
      P("s1", "undergrad"),
      P("s2", "undergrad"),
      P("s3", "masters"),
    ];
    const out = assignMentees(people, { mentorCapacity: 2 });
    expect(out.length).toBe(3); // 3 mentees, capacity 2*2=4 seats → all placed
    const menteeIds = out.map((a) => a.menteeId);
    expect(new Set(menteeIds).size).toBe(3); // each mentee once
    const load = new Map<string, number>();
    for (const a of out) load.set(a.mentorId, (load.get(a.mentorId) ?? 0) + 1);
    for (const n of load.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it("leaves a mentee unassigned when mentor seats run out", () => {
    const people = [P("m1", "phd"), P("s1", "undergrad"), P("s2", "undergrad")];
    const out = assignMentees(people, { mentorCapacity: 1 });
    expect(out.length).toBe(1); // only one seat
  });

  it("returns nothing when there are no mentors at all", () => {
    const people = [P("s1", "undergrad"), P("s2", "masters")];
    expect(assignMentees(people)).toEqual([]);
  });

  it("returns nothing when there are no mentees at all", () => {
    const people = [P("m1", "phd"), P("m2", "industry")];
    expect(assignMentees(people)).toEqual([]);
  });

  it("returns nothing for an empty roster", () => {
    expect(assignMentees([])).toEqual([]);
  });
});

describe("suggestGroups", () => {
  it("fuses two pairs into a foursome and keeps an odd pair as a duo", () => {
    const people = [
      P("m1", "phd"),
      P("s1", "undergrad"),
      P("m2", "phd"),
      P("s2", "undergrad"),
      P("m3", "phd", { field: "Biology", researchArea: "Genomics" }),
      P("s3", "undergrad", { field: "Biology", researchArea: "Genomics" }),
    ];
    const assignments = assignMentees(people, { mentorCapacity: 1 });
    const groups = suggestGroups(assignments, people);
    const sizes = groups.map((g) => g.memberIds.length).sort();
    expect(sizes).toEqual([2, 4]); // one foursome + one leftover duo
    // no person appears twice across groups
    const all = groups.flatMap((g) => g.memberIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it("never fuses two pairs that share a mentor (foursome has 4 distinct people)", () => {
    // One popular mentor (capacity 2) draws two mentees → two pairs share that mentor.
    const people = [
      P("m1", "phd"),
      P("s1", "undergrad", { school: "A" }),
      P("s2", "undergrad", { school: "B" }),
      P("m2", "phd", { field: "Biology", researchArea: "Genomics" }),
      P("s3", "undergrad", { field: "Biology", researchArea: "Genomics" }),
    ];
    const assignments = assignMentees(people, { mentorCapacity: 2 });
    const groups = suggestGroups(assignments, people);
    for (const g of groups) expect(new Set(g.memberIds).size).toBe(g.memberIds.length);
  });

  it("respects the affinity floor: weak pairs stay as duos instead of a forced group", () => {
    // Two same-field pairs (would fuse ~1.0) + one unrelated Physics pair. With a high
    // floor, the Physics pair has no above-floor partner and must stay a duo.
    const people = [
      P("m1", "phd", { field: "CS", researchArea: "CV" }),
      P("s1", "undergrad", { field: "CS", researchArea: "CV" }),
      P("m2", "phd", { field: "CS", researchArea: "CV" }),
      P("s2", "undergrad", { field: "CS", researchArea: "CV" }),
      P("m3", "phd", { field: "Physics", researchArea: "Optics" }),
      P("s3", "undergrad", { field: "Physics", researchArea: "Optics" }),
    ];
    const assignments = assignMentees(people, { mentorCapacity: 1 });
    const floored = suggestGroups(assignments, people, { affinityFloor: 0.5 });
    const sizes = floored.map((g) => g.memberIds.length).sort();
    expect(sizes).toEqual([2, 4]); // CS pairs fuse; Physics pair left as a duo
    // With floor 0, everything can fuse (3 pairs → one group of 4 + one duo).
    const nofloor = suggestGroups(assignments, people, { affinityFloor: 0 });
    expect(nofloor.some((g) => g.memberIds.length === 4)).toBe(true);
  });

  it("returns nothing for an empty assignment list", () => {
    expect(suggestGroups([], [])).toEqual([]);
  });

  it("treats the affinity floor as inclusive (affinity === floor still fuses)", () => {
    const people = [
      P("m1", "phd", { field: "CS", researchArea: "CV" }),
      P("s1", "undergrad", { field: "CS", researchArea: "CV" }),
      P("m2", "phd", { field: "CS", researchArea: "CV" }),
      P("s2", "undergrad", { field: "CS", researchArea: "CV" }),
    ];
    const assignments = assignMentees(people, { mentorCapacity: 1 });
    // Discover the exact affinity these two pairs fuse at (floor 0 always fuses),
    // then re-run with that exact value as the floor — `affinity < floor` should
    // exclude nothing when they're equal, so the pairs should still fuse.
    const [{ affinity }] = suggestGroups(assignments, people, { affinityFloor: 0 });
    const atFloor = suggestGroups(assignments, people, { affinityFloor: affinity });
    expect(atFloor.length).toBe(1);
    expect(atFloor[0].memberIds.length).toBe(4);
  });
});
