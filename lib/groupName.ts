// lib/groupName.ts
// Deterministic group namer: pick a playful name from data/group-names.json based on the
// group's identity (shared interests / field keywords) instead of "Table 1 / Table 2".
// No API key. See docs/group-naming-logic.md. Gemini is the optional future upgrade.
import bank from "../data/group-names.json";

export type NameableMember = { interests?: string[]; position?: string; field?: string };

// Keyword → field category. Order matters only for readability; scoring is by member hits.
const FIELD_KEYWORDS: Record<"engineering" | "cs_data" | "bio_chem", string[]> = {
  engineering: ["robot", "mechanical", "electrical", "circuit", "hardware", "aerospace", "materials", "civil", "mechatron"],
  cs_data: ["ai", "ml", "machine learning", "software", "data", "nlp", "computer", "coding", "systems", "llm", "developer"],
  bio_chem: ["bio", "chem", "genom", "neuro", "medic", "health", "climate", "energy", "batter", "physics"],
};

const VIBE = bank.vibe as Record<string, string[]>;
const FLAT: string[] = [
  ...bank.engineering, ...bank.cs_data, ...bank.bio_chem, ...bank.mixed,
  ...Object.values(VIBE).flat(),
];

const tokensOf = (m: NameableMember) =>
  [...(m.interests ?? []), m.position ?? "", m.field ?? ""].join(" ").toLowerCase();

// How many members hit at least one keyword in `keys`.
const memberHits = (members: NameableMember[], keys: string[]) =>
  members.filter((m) => {
    const t = tokensOf(m);
    return keys.some((k) => t.includes(k));
  }).length;

const firstUnused = (pool: string[], used: Set<string>) => pool.find((n) => !used.has(n));

// Name one group. `used` accumulates names already taken in this batch (dedupe).
export function nameGroup(members: NameableMember[], used: Set<string> = new Set()): string {
  const n = members.length;
  // BUG FIX: Math.ceil(0/2) is 0, and every category's hit-count (also 0) trivially
  // satisfies `hits >= majority` when majority is 0 — an empty group used to get a
  // confident vibe/field name (e.g. "Send It") with zero members backing it. Floor
  // majority at 1 so an empty (or interest-less) group always falls through to "mixed".
  const majority = Math.max(1, Math.ceil(n / 2));

  // 1. A shared vibe interest (climbing / coffee / startups) held by most members wins.
  for (const [interest, pool] of Object.entries(VIBE)) {
    if (memberHits(members, [interest]) >= majority) {
      const name = firstUnused(pool, used);
      if (name) return take(name, used);
    }
  }

  // 2. Otherwise the field category with the most members, if it's a real majority.
  const scored = (Object.keys(FIELD_KEYWORDS) as (keyof typeof FIELD_KEYWORDS)[])
    .map((cat) => ({ cat, hits: memberHits(members, FIELD_KEYWORDS[cat]) }))
    .sort((a, b) => b.hits - a.hits);
  if (scored[0].hits >= majority && scored[0].hits > (scored[1]?.hits ?? 0)) {
    const name = firstUnused(bank[scored[0].cat], used);
    if (name) return take(name, used);
  }

  // 3. Mixed / no clear identity.
  const mixed = firstUnused(bank.mixed, used);
  if (mixed) return take(mixed, used);

  // 4. Everything in the bank is taken this batch — fall through to any unused, then a counter.
  const any = firstUnused(FLAT, used);
  return take(any ?? `Crew ${used.size + 1}`, used);
}

function take(name: string, used: Set<string>): string {
  used.add(name);
  return name;
}

// Name a whole batch of groups (unique names within the batch).
export function nameGroups(
  groups: { memberIds: string[] }[],
  profiles: Map<string, NameableMember>,
): string[] {
  const used = new Set<string>();
  return groups.map((g) =>
    nameGroup(g.memberIds.map((id) => profiles.get(id) ?? {}), used),
  );
}
