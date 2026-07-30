// lib/mentorMatch.ts
// Interest-based mentor–mentee matchmaking for conference attendees.
// Pure + deterministic so it can be TDD'd and dumped to a CSV for tuning.
//
// Pipeline: classify → scorePair (every pair) → assignMentees (1:1, capped)
//           → suggestGroups (fuse two pairs into a group).

export type Role = "undergrad" | "masters" | "phd" | "industry";

export type Person = {
  id: string;
  name: string;
  school: string;
  role: Role;
  field: string; // broad major, e.g. "Computer Science"
  researchArea: string; // finer sub-area, e.g. "Computer Vision"
  interests: string[]; // free tags, e.g. ["startups", "climbing"]
};

// One place to tune everything. When the CSV looks off, change numbers here.
export const WEIGHTS = {
  field: 0.3,
  research: 0.4,
  interest: 0.3,
  mentorshipRoleFactor: 1.0,
  peerRoleFactor: 0.7,
  crossSchoolBonus: 0.05,
  mentorCapacity: 2,
  groupAffinityFloor: 0.4, // don't fuse two pairs below this — leave them as 1:1 duos
} as const;

const MENTOR_ROLES: ReadonlySet<Role> = new Set<Role>(["phd", "industry"]);

export const isMentor = (p: Person) => MENTOR_ROLES.has(p.role);
export const isMentee = (p: Person) => !isMentor(p);
export const classify = (p: Person): "mentor" | "mentee" =>
  isMentor(p) ? "mentor" : "mentee";

export type PairType = "mentorship" | "peer";

export type PairScore = {
  field: number;
  research: number;
  interest: number;
  topic: number; // weighted blend of the three, 0–1
  roleFactor: number;
  crossSchool: number;
  total: number; // final 0–1 compatibility
  pairType: PairType;
};

// Jaccard overlap of two interest lists (case-insensitive). Empty ∪ empty → 0.
export function jaccard(a: string[], b: string[]): number {
  const norm = (xs: string[]) => new Set(xs.map((x) => x.trim().toLowerCase()).filter(Boolean));
  const sa = norm(a);
  const sb = norm(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function pairType(a: Person, b: Person): PairType {
  return isMentor(a) !== isMentor(b) ? "mentorship" : "peer";
}

export function scorePair(a: Person, b: Person): PairScore {
  const field = a.field === b.field ? 1 : 0;
  // Same exact research area is the strongest signal; same field but different
  // area is a partial match; unrelated field scores nothing.
  const research = a.researchArea === b.researchArea ? 1 : field === 1 ? 0.5 : 0;
  const interest = jaccard(a.interests, b.interests);

  const topic = WEIGHTS.field * field + WEIGHTS.research * research + WEIGHTS.interest * interest;

  const type = pairType(a, b);
  const roleFactor = type === "mentorship" ? WEIGHTS.mentorshipRoleFactor : WEIGHTS.peerRoleFactor;
  const crossSchool = a.school !== b.school ? WEIGHTS.crossSchoolBonus : 0;

  const total = Math.min(1, topic * roleFactor + crossSchool);
  return { field, research, interest, topic, roleFactor, crossSchool, total, pairType: type };
}

export type Assignment = { menteeId: string; mentorId: string; score: number };

// Greedy 1:1: rank every mentee×mentor pair by score, assign a mentee to a mentor
// while the mentee is unassigned and the mentor is under capacity.
// ponytail: greedy, not globally optimal (no Hungarian) — fine for validating scores.
export function assignMentees(
  people: Person[],
  opts: { mentorCapacity?: number } = {},
): Assignment[] {
  const cap = opts.mentorCapacity ?? WEIGHTS.mentorCapacity;
  const mentors = people.filter(isMentor);
  const mentees = people.filter(isMentee);

  const ranked: Assignment[] = [];
  for (const mentee of mentees)
    for (const mentor of mentors)
      ranked.push({ menteeId: mentee.id, mentorId: mentor.id, score: scorePair(mentee, mentor).total });
  ranked.sort((x, y) => y.score - x.score);

  const menteeTaken = new Set<string>();
  const mentorLoad = new Map<string, number>();
  const out: Assignment[] = [];
  for (const a of ranked) {
    if (menteeTaken.has(a.menteeId)) continue;
    if ((mentorLoad.get(a.mentorId) ?? 0) >= cap) continue;
    menteeTaken.add(a.menteeId);
    mentorLoad.set(a.mentorId, (mentorLoad.get(a.mentorId) ?? 0) + 1);
    out.push(a);
  }
  return out;
}

export type SuggestedGroup = { memberIds: string[]; affinity: number };

// How well two matched pairs would mesh as a group: mean TOPIC score across the
// four cross-pair combos (role-neutral — grouping is about shared field/vibe, not mentorship).
function groupAffinity(pairA: [Person, Person], pairB: [Person, Person]): number {
  const combos: [Person, Person][] = [
    [pairA[0], pairB[0]],
    [pairA[0], pairB[1]],
    [pairA[1], pairB[0]],
    [pairA[1], pairB[1]],
  ];
  return combos.reduce((s, [x, y]) => s + scorePair(x, y).topic, 0) / combos.length;
}

// Fuse assigned pairs into groups of 4: rank every pair-of-pairs by affinity, greedily
// merge unused pairs. A pair with no good partner (below the floor, or odd one out) stays a duo.
export function suggestGroups(
  assignments: Assignment[],
  people: Person[],
  opts: { affinityFloor?: number } = {},
): SuggestedGroup[] {
  const floor = opts.affinityFloor ?? WEIGHTS.groupAffinityFloor;
  const byId = new Map(people.map((p) => [p.id, p]));
  const pairs = assignments.map((a) => {
    const mentee = byId.get(a.menteeId)!;
    const mentor = byId.get(a.mentorId)!;
    return { members: [mentee, mentor] as [Person, Person] };
  });

  const cand: { i: number; j: number; affinity: number }[] = [];
  for (let i = 0; i < pairs.length; i++)
    for (let j = i + 1; j < pairs.length; j++) {
      // A capacity>1 mentor sits in several pairs; fusing two of them would make a
      // "group" of only 3 distinct people. Only fuse pairs with no shared member.
      const ids = new Set(pairs[i].members.map((p) => p.id));
      if (pairs[j].members.some((p) => ids.has(p.id))) continue;
      const affinity = groupAffinity(pairs[i].members, pairs[j].members);
      if (affinity < floor) continue; // too weak to force together — better left as a 1:1
      cand.push({ i, j, affinity });
    }
  cand.sort((x, y) => y.affinity - x.affinity);

  const used = new Set<number>();
  const groups: SuggestedGroup[] = [];
  for (const c of cand) {
    if (used.has(c.i) || used.has(c.j)) continue;
    used.add(c.i);
    used.add(c.j);
    groups.push({
      memberIds: [...pairs[c.i].members, ...pairs[c.j].members].map((p) => p.id),
      affinity: c.affinity,
    });
  }
  // Leftover unpaired pair (odd count) stays a duo.
  for (let i = 0; i < pairs.length; i++)
    if (!used.has(i))
      groups.push({ memberIds: pairs[i].members.map((p) => p.id), affinity: 0 });
  return groups;
}
