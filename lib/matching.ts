// lib/matching.ts
import Anthropic from "@anthropic-ai/sdk";

export type SignupProfile = { userId: string; name: string; school: string;
  position: string; interests: string[]; partySize?: number; notes?: string };
export type MatchGroup = { memberIds: string[]; name: string; rationale: string;
  starterQuestion: string };

// A table's "size" is its total headcount — the sum of each member's party_size,
// not the number of signup rows. A signup that comes with 2 friends weighs 3.
const sizeOf = (id: string, sizes?: Map<string, number>) => sizes?.get(id) ?? 1;
const headcountOf = (ids: string[], sizes?: Map<string, number>) =>
  ids.reduce((n, id) => n + sizeOf(id, sizes), 0);

// Only ever set by roundRobinGroups() — the LLM's prompt asks for a warm,
// specific rationale, so it never coincidentally produces this exact string.
// Used to tell an LLM-matched group from a round-robin/repacked one after
// the fact, without threading a separate provenance field through everywhere.
export const ROUND_ROBIN_RATIONALE = "Grouped to keep tables even.";

export function validateAssignment(signupIds: string[],
  groups: { memberIds: string[] }[], min = 4, max = 6, sizes?: Map<string, number>) {
  const seen = new Map<string, number>();
  for (const g of groups) for (const id of g.memberIds)
    seen.set(id, (seen.get(id) ?? 0) + 1);
  const dupes = [...seen].filter(([, c]) => c > 1).map(([id]) => id);
  const missing = signupIds.filter(id => !seen.has(id));
  const extra = [...seen.keys()].filter(id => !signupIds.includes(id));
  // Bounds are by headcount. Oversize (> max) is a hard fail. Undersize (< min) is
  // reported but not fatal: indivisible parties can force an unavoidable small table.
  const oversize = groups.flatMap((g, i) => headcountOf(g.memberIds, sizes) > max ? [i] : []);
  const undersize = groups.flatMap((g, i) =>
    groups.length > 1 && headcountOf(g.memberIds, sizes) < min ? [i] : []);
  return { ok: !dupes.length && !missing.length && !extra.length && !oversize.length,
    missing: [...missing, ...extra], dupes, oversize, undersize };
}

// Balanced first-fit-decreasing packer BY HEADCOUNT. Each signup is an atom carrying
// its party_size; atoms are never split. Pre-create round(total/target) bins, place each
// atom (largest first) into the least-loaded bin that stays <= max, else open a new bin.
export function roundRobinGroups(signups: SignupProfile[], target = 5): MatchGroup[] {
  const max = 6;
  const atoms = signups
    .map(s => ({ id: s.userId, size: s.partySize ?? 1 }))
    .sort((a, b) => b.size - a.size);
  const total = atoms.reduce((n, a) => n + a.size, 0);
  // Balance toward `target` per table, but never provision fewer bins than are needed
  // to fit everyone under `max` — else e.g. 7 solos round to 1 bin and spill to 6+1
  // instead of a balanced 4+3.
  const binCount = Math.max(1, Math.round(total / target), Math.ceil(total / max));
  const bins: { ids: string[]; load: number }[] =
    Array.from({ length: binCount }, () => ({ ids: [], load: 0 }));

  for (const atom of atoms) {
    const fits = bins.filter(b => b.load + atom.size <= max);
    const bin = fits.length
      ? fits.reduce((lo, b) => (b.load < lo.load ? b : lo))
      : (() => { const b = { ids: [] as string[], load: 0 }; bins.push(b); return b; })();
    bin.ids.push(atom.id);
    bin.load += atom.size;
  }

  return bins
    .filter(b => b.ids.length > 0 || bins.length === 1)
    .map((b, i) => ({ memberIds: b.ids, name: `Table ${i + 1}`,
      rationale: ROUND_ROBIN_RATIONALE, starterQuestion: "" }));
}

// Keeps whatever groups are already valid from a failed attempt and only
// re-packs the ones that aren't, instead of discarding the entire slot.
// A broken partition (duplicated or missing signups) can't be trusted at the
// group level — there's no reliable way to tell which groups are "real" when
// the LLM has literally lost or duplicated a user, so that case still repacks
// everyone. Oversize-only failures (a clean partition, some tables just too
// big) repack just the flagged groups' members.
export function repackInvalid(
  groups: MatchGroup[],
  signupIds: string[],
  signups: SignupProfile[],
  min = 4,
  max = 6,
  sizes?: Map<string, number>,
): MatchGroup[] {
  const validation = validateAssignment(signupIds, groups, min, max, sizes);
  if (validation.ok) return groups;
  if (validation.dupes.length || validation.missing.length) return roundRobinGroups(signups);

  const bad = new Set(validation.oversize);
  const valid = groups.filter((_, i) => !bad.has(i));
  const invalidIds = new Set(groups.flatMap((g, i) => (bad.has(i) ? g.memberIds : [])));
  const invalidSignups = signups.filter(s => invalidIds.has(s.userId));
  return [...valid, ...roundRobinGroups(invalidSignups)];
}

// Pure + exported so the prompt text is unit-testable without hitting the
// Anthropic API. `eventName` comes from the admin-registered `conferences`
// row (lib/conference.ts) — generic fallback if unset. No `location`/place:
// where to actually meet is left to the group, not invented by the LLM —
// see docs/HANDOFF.md for why (an earlier version asked for a "suggested
// cuisine near X," which produced ungrounded, sometimes nonsensical results
// with no real venue data behind it).
export function buildMatchPrompt(
  roster: unknown,
  opts: { min: number; max: number; eventName?: string },
): string {
  const { min, max, eventName } = opts;
  const event = eventName || "conference";
  return `Group these ${event} attendees into dinner tables by shared research interests and vibe. Each table must seat ${min}-${max} people TOTAL. IMPORTANT: an attendee with "comesWithGroupOf": N arrives with a party of N people (including themselves) — count them as N seats and keep that whole party at one table. Every attendee appears in EXACTLY one group. Give each group a short fun name, a one-sentence "why you matched" rationale (warm, specific, mention shared interests), and a fun icebreaker question the table could open with — grounded in what they actually have in common, not generic small talk.\n\nAttendees:\n${JSON.stringify(roster, null, 1)}`;
}

const TOOL = {
  name: "submit_groups",
  description: "Submit the final grouping",
  input_schema: {
    type: "object" as const,
    properties: { groups: { type: "array", items: { type: "object", properties: {
      memberIds: { type: "array", items: { type: "string" } },
      name: { type: "string" }, rationale: { type: "string" },
      starterQuestion: { type: "string" } },
      required: ["memberIds", "name", "rationale", "starterQuestion"] } } },
    required: ["groups"] },
};

export async function matchSlot(signups: SignupProfile[],
  opts: { min?: number; max?: number; model?: string; eventName?: string } = {}): Promise<MatchGroup[]> {
  const { min = 4, max = 6, model = "claude-sonnet-5", eventName } = opts;
  // Nothing to match — skip the API call for a trivially empty roster. Every
  // *real* slot (however small) still runs the interest-aware LLM path below;
  // round-robin is reserved for genuine failure, not "small headcount."
  if (signups.length === 0) return roundRobinGroups(signups);
  const sizes = new Map(signups.map(s => [s.userId, s.partySize ?? 1]));
  const client = new Anthropic();
  const ids = signups.map(s => s.userId);
  const roster = signups.map(s => (s.partySize ?? 1) > 1
    ? { ...s, comesWithGroupOf: s.partySize } : s);
  const prompt = buildMatchPrompt(roster, { min, max, eventName });
  let lastGroups: MatchGroup[] | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.messages.create({ model, max_tokens: 4096,
      tools: [TOOL], tool_choice: { type: "tool", name: "submit_groups" },
      messages: [{ role: "user", content: prompt }] });
    const call = res.content.find(b => b.type === "tool_use");
    if (call && call.type === "tool_use") {
      const groups = (call.input as { groups: MatchGroup[] }).groups;
      if (validateAssignment(ids, groups, min, max, sizes).ok) return groups;
      lastGroups = groups; // keep the last attempt around in case both fail
    }
  }
  // ponytail: after 2 tries, keep whatever tables were already valid from the
  // last attempt and only re-pack the ones that weren't, rather than discard
  // the whole slot. Falls all the way back to round-robin if no attempt ever
  // returned a usable tool call at all.
  return lastGroups ? repackInvalid(lastGroups, ids, signups, min, max, sizes) : roundRobinGroups(signups);
}
