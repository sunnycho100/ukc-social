# 04. Matching: seating people at tables

Index: [README.md](README.md) · Test-id prefix: `MATCH`

The core algorithm. One function, `matchOneSlot`, is the only matching pipeline in
the app. Both the manual admin button and the auto-match cron call it, so there is
exactly one code path to reason about.

**Files**

| File | Role |
|---|---|
| `app/actions/admin.ts` | `matchOneSlot` (the pipeline), `runMatching` (admin entry), `runAllSlotsMatching` (cron entry) |
| `lib/matching.ts` | `matchSlot` (LLM), `validateAssignment`, `roundRobinGroups`, `repackInvalid`, `buildMatchPrompt` |
| `lib/scheduleFilter.ts` | `isEligibleForSlot`, the hard pre-filter |
| `lib/groupName.ts` | `nameGroup`, `nameGroups` |
| `data/group-names.json` | the name bank |

**Related docs:** [`docs/group-naming-logic.md`](../group-naming-logic.md) predates
this file and covers the name bank in more depth.

---

## Scenario

An admin (or the cron) runs matching for one dinner slot. Everyone who signed up and
is actually in town that day is seated at a table of 4 to 6 people, grouped by
shared research interests, with a table name, a "why you matched" line, and an
icebreaker question. Everyone seated gets a notification.

---

## The pipeline, step by step

### 1. Read signups

```sql
select user_id, party_size, notes,
       profiles(name, school, position, interests, event_id, stay_start, stay_end)
from signups where slot_id = $1
```

Through the **service client**, so RLS does not apply and the join returns every
attendee's profile regardless of who shares a channel with whom. Supabase types the
joined relation as an array; the code normalizes it with
`Array.isArray(r.profiles) ? r.profiles[0] : r.profiles`.

### 2. Hard schedule filter

Every row is passed through `isEligibleForSlot(profile, slot.starts_at)`. Anyone
who fails is dropped from this run and counted into `excluded`. They are **not**
deleted from `signups`; a later run with corrected dates will pick them up.

The rule, from `lib/scheduleFilter.ts`:

| Condition | Eligible |
|---|---|
| `event_id` falsy | no. They picked "just exploring" or never onboarded |
| `stay_start` or `stay_end` missing | yes. Nothing to compare against, do not block on absent data |
| otherwise | `stay_start <= slotDate && slotDate <= stay_end`, string compare on `YYYY-MM-DD` |

This runs in two places on purpose: here, and at join time in `joinSlot`. The
join-time check is the front line and is skippable by the user via the "Join anyway"
confirmation; this one is the backstop and is not skippable.

If nothing survives, the function returns `{ok: true, groups: 0, excluded}` without
touching the database.

### 3. LLM pass

`matchSlot(signups, { eventName })` in `lib/matching.ts`:

- Builds a `sizes` map of `userId → party_size`.
- Builds the roster, adding `comesWithGroupOf: N` to anyone with a party larger
  than 1.
- Calls `buildMatchPrompt(roster, { min: 4, max: 6, eventName })`. That function is
  pure and exported precisely so the prompt text is unit-testable without an API
  key. It asks for tables of 4 to 6 **total seats**, tells the model that
  `comesWithGroupOf: N` means N seats that must stay together, and asks for a short
  fun name, a warm specific rationale, and an icebreaker question grounded in what
  the table actually has in common.
- Calls `claude-sonnet-5` with `max_tokens: 4096` and a **forced tool call**
  (`tool_choice: { type: "tool", name: "submit_groups" }`). The tool schema requires
  `memberIds`, `name`, `rationale`, `starterQuestion` on every group.
- Up to **2 attempts**. After each, `validateAssignment` runs. The first valid
  result is returned. Otherwise the last returned grouping is kept as `lastGroups`.
- After both attempts fail: `repackInvalid(lastGroups, …)` if there was any usable
  tool call, else `roundRobinGroups(signups)`.

`buildMatchPrompt` deliberately takes no location or venue. An earlier version asked
for a "suggested cuisine near X" and produced ungrounded results with no real venue
data behind it. Migration `0015` renamed the column to `starter_question` and the
prompt now asks for an icebreaker instead. `lib/matching.test.ts` has a regression
test asserting the prompt mentions "icebreaker question" and does not mention
"cuisine" or "suggested place".

### 4. Validation

`validateAssignment(signupIds, groups, min = 4, max = 6, sizes)` returns:

| Field | Meaning |
|---|---|
| `dupes` | user ids appearing in more than one group |
| `missing` | signup ids in no group, **concatenated with** ids that appear in a group but were never signed up ("extra") |
| `oversize` | group indexes whose **headcount** exceeds `max` |
| `undersize` | group indexes whose headcount is below `min`, only reported when there is more than one group |
| `ok` | true when `dupes`, `missing`, and `oversize` are all empty |

Headcount is the sum of party sizes, not the number of member ids. A table with two
signups of party 3 each has headcount 6, not 2.

**Undersize is not fatal.** Indivisible parties can force an unavoidable small
table, so it is reported and surfaced in the admin UI as `flex: yes` rather than
triggering a repack.

### 5. Repack, not discard

`repackInvalid(groups, signupIds, signups, min, max, sizes)`:

```
validation.ok                        → return groups unchanged
dupes or missing non-empty           → roundRobinGroups(ALL signups)
otherwise (oversize only)            → keep the valid groups,
                                       roundRobinGroups(just the flagged members)
```

The split is deliberate. A partition with a duplicated or lost user cannot be
trusted at the group level, because there is no reliable way to tell which groups
are real when the model has literally invented or dropped someone. An oversize-only
failure is a clean partition where some tables are just too big, so the good tables
survive and only the bad ones are repacked.

`matchOneSlot` calls `repackInvalid` a second time after `matchSlot` returns. That
is intentional belt and braces: `matchSlot` may already have repacked, in which case
the second call validates clean and returns unchanged.

### 6. `roundRobinGroups`: the fallback packer

A balanced first-fit-decreasing bin packer **by headcount**. Each signup is an atom
carrying its party size and is never split.

```
atoms    = signups → {id, size}, sorted by size descending
total    = sum of sizes
binCount = max(1, round(total / target), ceil(total / max))     target = 5, max = 6
bins     = binCount empty bins

for each atom (largest first):
    fits = bins where load + size <= max
    if fits is non-empty → place in the least loaded of them
    else                 → open a new bin and place it there
```

The `ceil(total / max)` term in `binCount` exists because rounding alone
underprovisions: 7 solo attendees round to 1 bin and would spill to 6 plus 1 instead
of a balanced 4 plus 3.

Output groups are named `Table 1`, `Table 2`, … numbered **after** empty bins are
filtered out, carry `ROUND_ROBIN_RATIONALE` ("Grouped to keep tables even.") and an
empty `starterQuestion`.

`ROUND_ROBIN_RATIONALE` is exported and compared by string. That is how the rest of
the pipeline tells an LLM-matched table from a mechanically packed one without
threading a provenance field through every layer. The prompt asks for a warm
specific rationale, so it will not coincidentally produce that exact sentence.

### 7. Naming

`nameGroups(groups, profileMap)` in `lib/groupName.ts` assigns a themed name from
`data/group-names.json`, deduped within the batch via a shared `used` set.

For each group, with `majority = max(1, ceil(memberCount / 2))`:

1. **Vibe interest.** For each of `climbing`, `coffee`, `startups`, if at least
   `majority` members have that word in their interests, position, or field, take the
   first unused name from that vibe pool.
2. **Field category.** Score `engineering`, `cs_data`, `bio_chem` by how many members
   hit any of their keywords. Take the top category only if it reaches `majority`
   **and** strictly beats the runner-up.
3. **Mixed.** Fall through to the `mixed` pool.
4. **Exhausted.** Any unused name from the flattened bank, else `Crew {n}`.

The `max(1, …)` floor on `majority` is a recorded bug fix: `ceil(0 / 2)` is 0, and
every category's hit count of 0 trivially satisfied `hits >= 0`, so an empty group
used to receive a confident vibe name with zero members backing it.

**Only LLM-matched tables get themed names.** `matchOneSlot` filters to groups whose
rationale is not `ROUND_ROBIN_RATIONALE`, names only those, and walks the result
with an index counter so positions line up. A round-robin table keeps its plain
"Table N" name, because a themed name would contradict its honest "grouped to keep
tables even" rationale.

### 8. Write

Through the service client, in this order:

1. `delete from groups where slot_id = $1`, which cascades to `group_members`.
2. `insert into groups (…) returning id`, one row per group, with
   `meet_time = slot.starts_at`.
3. `insert into group_members`, flattened from the returned ids.
4. `insert into notifications`, one `table_revealed` per seated member, payload
   `{group_id, slot_id}`. Not error-checked: the groups are already committed, and a
   notification failure must not fail the match.

Re-running is idempotent by destruction. It is also **not atomic**: a failure
between steps 1 and 2 leaves the slot with no tables at all.

### 9. Result

```ts
{ ok: true, groups: number, flex: boolean, excluded: number }
```

`flex` is true when at least one table seats fewer than 4 by headcount. The admin
row renders it as "N groups · flex: yes · M left unmatched (schedule)".

---

## Tables and RLS touched

Everything in this flow runs through `serviceClient()`, which bypasses RLS entirely.
That is required: `groups` and `group_members` have **no** insert, update, or delete
policies at all, and `notifications` has no insert policy, precisely because every
one of these writes targets rows the actor does not own.

| Table | Operation |
|---|---|
| `signups` | select with a `profiles` join |
| `slots` | select `id, starts_at` |
| `conferences` | select, for `eventName` in the prompt |
| `groups` | delete by slot, then insert |
| `group_members` | insert (deleted by cascade) |
| `notifications` | insert, best-effort |

---

## Edge cases

| id | Case | Expected | Verified |
|---|---|---|---|
| `MATCH-E01` | Slot has zero signups | Returns `{ok: true, groups: 0, excluded}` without writing. Prior groups for the slot are **not** deleted, because the early return happens before the delete | code |
| `MATCH-E02` | Every signup fails the schedule filter | Same as E01. `excluded` equals the signup count | code |
| `MATCH-E03` | `ANTHROPIC_API_KEY` unset | `new Anthropic()` throws at construction, the `try/catch` in `matchOneSlot` catches it, and the whole slot is packed by `roundRobinGroups` | code |
| `MATCH-E04` | The Anthropic call errors mid-loop (rate limit, network) | The throw propagates out of `matchSlot` to the same `try/catch`, so the whole slot falls back to round-robin. Attempt 2 is not tried | code |
| `MATCH-E05` | Model returns no `tool_use` block on either attempt | `lastGroups` stays null, `roundRobinGroups(signups)` runs | code |
| `MATCH-E06` | Model duplicates a user across two tables | `dupes` non-empty → `ok: false` → attempt 2 → if it fails again, `repackInvalid` sees dupes and repacks **everyone** | unit |
| `MATCH-E07` | Model drops a user entirely | Same path via `missing` | unit |
| `MATCH-E08` | Model invents a user id that never signed up | Detected as "extra" and folded into `missing`, so it forces a full repack | unit |
| `MATCH-E09` | Model returns one table of 8 and the rest fine | Clean partition, oversize only. `repackInvalid` keeps the good tables and repacks just the 8 | unit |
| `MATCH-E10` | Model returns a table of 3 | Undersize is reported but **not** fatal. The table ships and `flex` becomes true | unit |
| `MATCH-E11` | One party of 6 signs up alone | Headcount 6 fits `max` exactly, so it becomes its own table. `roundRobinGroups` never splits a party | unit |
| `MATCH-E12` | Someone signs up with `party_size` 7 or more | Impossible: the column has `check (party_size between 1 and 6)` and `joinSlot` clamps to 6 | code |
| `MATCH-E13` | 7 solo attendees | `binCount = max(1, round(7/5)=1, ceil(7/6)=2) = 2`, so 4 plus 3, not 6 plus 1 | unit |
| `MATCH-E14` | Total headcount below 4, e.g. 3 solos | One bin, one table of 3. `undersize` is suppressed when there is only one group, but `flex` still reports true | unit |
| `MATCH-E15` | Atoms that cannot fit any existing bin | A new bin is opened beyond `binCount`, so the packer never fails to place someone | unit |
| `MATCH-E16` | `roundRobinGroups([])` | Returns one group with an empty `memberIds`, because the filter keeps a lone empty bin. Unreachable from `matchOneSlot`, which returns early on zero signups | unit |
| `MATCH-E17` | Repack produces names colliding with kept LLM tables | Repacked tables are numbered from `Table 1` again regardless of how many valid tables precede them, so two runs of the packer inside one slot can both produce "Table 1". Not currently guarded | code |
| `MATCH-E18` | Group with no interests at all | `majority` floors at 1, no category reaches it, so the name falls through to the `mixed` pool | unit |
| `MATCH-E19` | More groups than names in the bank | `firstUnused` returns undefined, falls to any unused name in the flattened bank, then to `Crew {n}` | unit |
| `MATCH-E20` | Two field categories tie for the top | The `> runner-up` condition fails, so it falls through to `mixed` rather than picking arbitrarily | unit |
| `MATCH-E21` | Re-run on a slot that already has tables | Prior groups are deleted (cascading members) and new ones inserted. Members can be reshuffled onto different tables, and everyone gets a **second** `table_revealed` notification | code |
| `MATCH-E22` | Insert fails after the delete | Returns `{ok: false, error}` and the slot is left with **no** tables. Not atomic | code |
| `MATCH-E23` | Notification insert fails | Ignored. The match is already committed and reported as successful | code |
| `MATCH-E24` | No conference registered | `eventName` is undefined and `buildMatchPrompt` substitutes the literal "conference" | unit |
| `MATCH-E25` | Party members' notes contain prompt-like text | Notes are serialized into the roster JSON verbatim with no sanitizing. A crafted note is prompt-injectable into the matching call | code |
| `MATCH-E26` | Non-admin calls `runMatching` | Returns `{ok: false, error: "forbidden"}` before touching anything | code |
