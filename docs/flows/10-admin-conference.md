# 10. Admin and conference registration

Index: [README.md](README.md) · Test-id prefix: `ADMIN`

**Files**

| File | Role |
|---|---|
| `app/admin/page.tsx` | the gate, the conference form, one row per slot |
| `components/AdminConferenceForm.tsx` | register or edit the conference |
| `components/AdminSlotRow.tsx` | per-slot "Run matching" with its result line |
| `app/actions/conference.ts` | `upsertConference` |
| `app/actions/admin.ts` | `runMatching` |
| `lib/conference.ts` | `getConference`, the `Conference` type |

**Related doc:** [`docs/CONFERENCE-GENERALIZATION.md`](../CONFERENCE-GENERALIZATION.md)
explains why the conference stopped being a code constant.

---

## Scenario

Before anything else works properly, an admin registers the conference: name, dates,
timezone, UTC offset, airport, and the auto-matching schedule. Later, they can force
a matching run for any individual slot instead of waiting for the cron.

## Screen sequence

```
/admin
  ├─ non-admin → notFound()
  ├─ AdminConferenceForm
  │     name · location · starts_at · ends_at · timezone · utc_offset · airport_code
  │     ☐ auto-matching enabled · interval (minutes)
  │     → [Save]  → "Saved." or "error: {message}"
  └─ per slot: title · N signups · [Run matching]
        → "3 groups · flex: no · 2 left unmatched (schedule)"
```

---

## The admin gate

Three independent checks, all comparing `user.email` to `process.env.ADMIN_EMAIL`:

| Where | Failure mode |
|---|---|
| `app/admin/page.tsx` | `notFound()`, so the page is a 404 rather than a 403 |
| `upsertConference` | `{ok:false, error:"forbidden"}` |
| `runMatching` (`requireAdmin()`) | `{ok:false, error:"forbidden"}` |

Each server action re-checks rather than trusting that the caller came from the
page, which is the right shape: server actions are individually invocable.

`runAllSlotsMatching` is the exception with no check of its own. See README §7.

There is no admin role in the database. `ADMIN_EMAIL` is a single environment
variable holding one address, and every privileged write reaches Postgres through
the service-role client rather than through a policy.

---

## `upsertConference`

```
auth: user.email === ADMIN_EMAIL                → else "forbidden"
validate name.trim() non-empty                  → "Name is required."
validate starts_at < ends_at                    → "Start date must be before end date."
validate matching_interval_minutes finite and > 0 → "Matching interval must be a positive number of minutes."
id present  → update conferences set ... where id = $id
id absent   → insert conferences
```

Through the service client, because `conferences` has only `c_sel` and no write
policy at all.

Upsert-by-id rather than always-insert makes it a de-facto singleton without a
database constraint: the form passes `conference?.id`, so an existing row is edited
and a first-time save inserts. `getConference` reads the most recently created row,
so even if several rows existed, the newest wins.

Note the two date validations disagree slightly. The action compares
`new Date(starts_at) >= new Date(ends_at)` and the table has
`check (starts_at < ends_at)`, so they agree on the boundary, but the action's
message is the one the admin sees.

### The form

`starts_at` and `ends_at` are `datetime-local` inputs. They are converted with
`toIso(local, form.utc_offset)`, the same fixed-offset parse `submitFlight` uses,
and rendered back with `toLocalInput(iso, timezone)`. That means **changing the
offset changes how existing dates are interpreted on the next save**, since the
form re-parses whatever is currently in the inputs with the new offset.

Field defaults when nothing is registered: timezone `America/New_York`, offset
`-04:00`, interval 360, auto-matching off, everything else empty.

The form also shows the computed auto-match window opening date
(`starts_at - 7 days`) so the admin can see when the cron will begin.

---

## `runMatching`

```
requireAdmin()                          → "forbidden"
select id, starts_at from slots where id = $1   → "slot not found"
getConference(serviceClient)
matchOneSlot(svc, slot, conference)
```

The full pipeline is documented in [04-matching.md](04-matching.md). The admin row
renders the result as:

```
{groups} group(s) · flex: {yes|no}[ · {excluded} left unmatched (schedule)]
```

`flex: yes` means at least one table seats fewer than 4 by headcount, which is
normal when indivisible parties force it. `left unmatched (schedule)` is the count
dropped by `isEligibleForSlot`, appended only when it is non-zero.

The button uses `useTransition`, so it is disabled and shows "Running…" for the
duration. Nothing prevents two admins, or two tabs, from running the same slot at
once.

---

## What `/admin` cannot do

The page is matching plus conference registration only. There is no UI to create,
edit, or delete `slots`; they are seeded directly into the database. There is no
way to view a matched table, undo a match, or exclude a person by hand.

---

## Tables and RLS touched

| Table | Operation | Client |
|---|---|---|
| `conferences` | select (page), insert or update (action) | caller's session for the read, service for the write |
| `slots` | select `id, title, starts_at` | caller's session, `s_sel` |
| `signups` | select `slot_id` for the counts | caller's session, `su_sel` |
| everything in the match pipeline | see [04-matching.md](04-matching.md) | service |

Note the signup counts on `/admin` count **rows**, not headcount, unlike `/meals`
which sums `party_size`. The same slot can therefore show "8 signups" on `/admin`
and "11 people in" on `/meals`.

---

## Edge cases

| id | Case | Expected | Verified |
|---|---|---|---|
| `ADMIN-E01` | Non-admin opens `/admin` | 404, not 403. The page's existence is not revealed | code |
| `ADMIN-E02` | `ADMIN_EMAIL` unset | `user.email !== undefined` is true for every real user, so nobody passes and `/admin` 404s for everyone | code |
| `ADMIN-E03` | Non-admin invokes `upsertConference` or `runMatching` directly | `{ok:false, error:"forbidden"}` before any read or write | code |
| `ADMIN-E04` | Non-admin invokes `runAllSlotsMatching` directly | No auth check exists on that action. Flagged in README §7 | code |
| `ADMIN-E05` | Save with an empty or whitespace-only name | "Name is required." The check is on `.trim()` | code |
| `ADMIN-E06` | End date before start date | "Start date must be before end date." The table's own `check` constraint would also reject it | code |
| `ADMIN-E07` | Start date exactly equal to end date | Rejected. The comparison is `>=` | code |
| `ADMIN-E08` | Interval of 0 or negative | "Matching interval must be a positive number of minutes." The column also has `check (matching_interval_minutes > 0)` | code |
| `ADMIN-E09` | Interval left blank | `Number("")` is 0, so it fails the positive check | code |
| `ADMIN-E10` | Interval set to 60 | Accepted and stored, but the cron only fires daily, so nothing changes in practice. See [05-auto-match.md](05-auto-match.md) | code |
| `ADMIN-E11` | Second conference registered while one exists | The form always passes the existing `id`, so it edits. A genuinely new row would require calling the action without an id | code |
| `ADMIN-E12` | `utc_offset` changed on an existing conference | The two `datetime-local` values currently in the form are re-parsed with the **new** offset, shifting the stored instants | code |
| `ADMIN-E13` | `timezone` set to an invalid IANA id | Saves fine. Every display path then throws in `Intl.DateTimeFormat` | code |
| `ADMIN-E14` | `airport_code` left empty | The rides board skips its airport filter entirely and shows every posted flight | code |
| `ADMIN-E15` | Run matching on a nonexistent slot id | `{ok:false, error:"slot not found"}` | code |
| `ADMIN-E16` | Run matching on a slot with zero signups | `0 groups · flex: no`. Existing groups for that slot are **not** cleared, because the pipeline returns before the delete | code |
| `ADMIN-E17` | Two admins run the same slot simultaneously | Both delete and both insert. No locking. The result is whichever insert lands last, possibly with duplicated members | code |
| `ADMIN-E18` | `SUPABASE_SERVICE_ROLE_KEY` unset | Every privileged write fails. `runMatching` surfaces it as `error: …`; the notification insert fails silently | code |
| `ADMIN-E19` | No slots exist | "No slots yet." There is no UI to create one | code |
| `ADMIN-E20` | `conferences` table missing (migration 0012 unapplied) | `getConference` returns null, the form renders in "Register your conference" mode, and the save fails | flag |
