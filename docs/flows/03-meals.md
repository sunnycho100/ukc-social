# 03. Meals: signing up for a dinner

Index: [README.md](README.md) · Test-id prefix: `MEAL`

**Files**

| File | Role |
|---|---|
| `app/(tabs)/meals/page.tsx` | server page plus the exported `MealsListSection()` |
| `components/MealsList.tsx` | the row list, optimistic state, sheet orchestration, toasts |
| `components/JoinSheet.tsx` | the join and edit form: party size, notes, conflict warning |
| `components/GoingSheet.tsx` | the lighter "you're already in" view |
| `app/actions/signups.ts` | `joinSlot`, `leaveSlot` |
| `lib/scheduleFilter.ts` | `isEligibleForSlot`, shared with the matcher |

`MealsListSection()` is exported separately from the page so `/matching` can embed
the same list without duplicating the queries. `/meals` and the Meals tab of
`/matching` therefore always show identical data.

---

## Scenario

An attendee opens Meals, sees every dinner slot with a live headcount, joins one
(alone or with a party), optionally edits how many they are bringing, and can leave
before the deadline. After matching runs, "Going" gains a link into the table chat.

## Screen sequence

```
/meals  (or /matching, Meals tab)
  └─ row per slot: title · when · area · "N people in"
       ├─ [Join ▸]   → JoinSheet   (not joined, deadline open)
       ├─ [Going ✓]  → GoingSheet  (already joined)
       └─  Closed     (deadline passed, no action)

JoinSheet   → party size 1-4 · notes · deadline notice → [Join] / [Save changes]
                                                       → [Leave this dinner]
GoingSheet  → [Open group chat] (once matched) / [Got it]
            → "Change how many / notes" → hands back to JoinSheet
            → [Leave this dinner]
```

`openId` drives `GoingSheet`, `editId` drives `JoinSheet`. They are separate pieces
of state and never both set: "Change how many" clears one and sets the other.

## Data the page computes

| Value | How |
|---|---|
| slot list | `slots` where `kind = 'meal'`, ordered by `starts_at` |
| `counts[slotId]` | sum of `party_size` across all signups for that slot, so a party of 3 counts as 3 |
| `mine[slotId]` | the caller's own signup, if any: `{partySize, notes}` |
| `myGroupBySlot[slotId]` | the caller's revealed group id for that slot, via `group_members` joined to `groups` |
| `closed` | `join_deadline <= nowMs`, where `nowMs` is stamped on the server at render |

`nowMs` is passed in from the server rather than read in the browser, so the closed
state is consistent for everyone in a render and does not shift with client clock
skew. It does mean a page left open across a deadline keeps showing the slot as
open until it is re-rendered.

---

## Algorithm: the join round-trip

`joinSlot(slotId, { partySize, notes, confirmed })` runs three checks in order:

1. **Slot exists.** Reads `join_deadline` and `starts_at`. Missing → `not_found`.
2. **Deadline.** `join_deadline <= Date.now()` → `closed`.
3. **Schedule fit,** skipped entirely when `confirmed` is true. Reads the caller's
   `event_id`, `stay_start`, `stay_end` and calls `isEligibleForSlot`. Ineligible →
   `schedule_conflict`, and **nothing is written**.

Then it clamps party size with `Math.min(6, Math.max(1, Math.round(partySize ?? 1)))`
and upserts the signup on `(slot_id, user_id)`.

`isEligibleForSlot` (`lib/scheduleFilter.ts`) is three lines of intent:

```
no event_id                     → false   (just exploring, never eligible)
stay_start or stay_end missing  → true    (nothing to compare, do not block)
otherwise                       → stay_start <= slotDate <= stay_end
```

`slotDate` is `slotStartsAt.slice(0, 10)`, a plain `YYYY-MM-DD` string compared
lexically against the two date columns. No timezone conversion happens here, which
is correct only because both sides are date-only.

The UI half of the round trip: `JoinSheet.handlePrimary` passes its own
`scheduleWarning` state as `confirmed`. First press sends `false`, gets
`schedule_conflict`, sets `scheduleWarning`, and the button relabels to "Join
anyway". Second press sends `true` and writes.

This is why `MealsList.handleJoin` **awaits the server before touching UI state**
instead of being optimistic. An optimistic join would close the sheet, then have to
reopen it to show the warning.

`handleLeave` is the opposite: it is optimistic (clears `mine`, decrements the
count, closes both sheets) and rolls the previous values back if `leaveSlot` fails,
showing "Couldn't leave. Try again."

---

## Tables and RLS touched

| Table | Operation | Policy |
|---|---|---|
| `slots` | select | `s_sel`, any authenticated |
| `signups` | select all (for counts), upsert self, delete self | `su_sel` any authenticated, `su_ins` self, `su_del` self, **no update policy** |
| `group_members`, `groups` | select for the chat link | `gm_sel` / `g_sel`, members only |

The headcount is computed from a full-table read of `signups`. `su_sel` allows any
authenticated user to read every signup row, which is what makes "N people in"
possible without a view or an aggregate.

---

## Edge cases

| id | Case | Expected | Verified |
|---|---|---|---|
| `MEAL-E01` | No meal slots exist | "Slots open soon." rendered instead of the list | code |
| `MEAL-E02` | Slot with zero signups | "Be the first in" instead of "0 people in" | code |
| `MEAL-E03` | Exactly one seat taken | "1 person in", singular | code |
| `MEAL-E04` | Join after the deadline passed | `joinSlot` returns `closed`, toast "This one just closed." The button would normally already read Closed | code |
| `MEAL-E05` | Join a slot outside the stay window | First call returns `schedule_conflict` and writes nothing. Sheet shows "You're leaving before this one, still join?" and relabels to "Join anyway" | code |
| `MEAL-E06` | Second press after the warning | Sends `confirmed: true`, skips the eligibility check, writes the signup | code |
| `MEAL-E07` | User has no `profiles` row at all | The eligibility read returns null, the `if (profile && …)` guard is false, so the join proceeds. Missing profile never blocks a join | code |
| `MEAL-E08` | Party size out of range, e.g. 0 or 99 | Clamped server-side to 1 to 6. The UI only offers 1 to 4; the database check allows up to 6 so one party can fill a table | code |
| `MEAL-E09` | Editing an existing signup ("Save changes") | Intended: party size and notes update, headcount adjusts by the delta. **Flagged:** the upsert compiles to `ON CONFLICT DO UPDATE` and `signups` has no UPDATE policy, so this may be rejected by RLS. Verify against a migrated database | flag |
| `MEAL-E10` | Leave then the delete fails | Optimistic removal is rolled back, count restored, toast "Couldn't leave. Try again." | code |
| `MEAL-E11` | Leave from `GoingSheet` | `onLeave` then `onClose`, both sheets close, row returns to "Join" | code |
| `MEAL-E12` | Guest presses Join | Routed to `/login`; the sheet never opens | code |
| `MEAL-E13` | Joined but matching has not run | `GoingSheet` shows "Tables revealed {deadline}" and a "Got it" button, no chat link | code |
| `MEAL-E14` | Joined and matching has run | `myGroupBySlot` has an entry, so the note becomes "Your table is set." and the primary becomes "Open group chat" | code |
| `MEAL-E15` | Party of 1 vs party of more | Hint text switches between "Come solo, we'll seat you with people worth meeting" and "We'll seat your group of N together with another small group" | code |
| `MEAL-E16` | Escape pressed in either sheet | Closes it. Tab is trapped inside, and focus returns to the element that opened it | code |
| `MEAL-E17` | Backdrop clicked | Closes. Clicks inside the sheet call `stopPropagation` so they do not bubble out and close it | code |
| `MEAL-E18` | Deadline passes while the page sits open | Row keeps showing Join because `nowMs` was stamped at render. Pressing it returns `closed` and toasts | code |
| `MEAL-E19` | Notes longer than expected | No length limit anywhere: not in the textarea, not in `joinSlot`, not in the column. Long notes flow into the matching prompt verbatim | code |
| `MEAL-E20` | Same user joins from two devices | The unique `(slot_id, user_id)` constraint means the second write updates rather than duplicates, subject to `MEAL-E09` | code |
