# Icebreaker: flows, algorithms, and API reference

_Written 2026-07-30 against commit `f1b17f9`. Every claim here was read out of the
code, not remembered._

This is the single document to read first. It explains what the app does, how a
request travels through it, what the database looks like, and what every flow does
end to end. The ten files linked below carry the step-by-step detail and the
edge-case tables that test cases get written from.

**Contents**

1. [What the app is](#1-what-the-app-is)
2. [Stack and request model](#2-stack-and-request-model)
3. [Data model and RLS](#3-data-model-and-rls)
4. [API reference](#4-api-reference)
5. [The flows](#5-the-flows)
6. [Cross-cutting rules](#6-cross-cutting-rules)
7. [Current state and known gaps](#7-current-state-and-known-gaps)
8. [Test-ID scheme](#8-test-id-scheme)

---

## 1. What the app is

A companion app for one conference. An attendee signs up, fills in a five-step
profile, and then does four things:

- **Eats.** Joins dinner slots. An LLM seats everyone into tables of 4 to 6 by
  shared research interests. The table is revealed with a name, a "why you
  matched" line, and an icebreaker question.
- **Rides.** Posts a landing and leaving time. Anyone flying within 30 minutes
  can join that flight's ride pool and split a car, capped at 4.
- **Meets.** Browses the attendee directory, filters by interest, school, and
  stay window, and sends a low-stakes "hi".
- **Talks.** Every revealed table gets a realtime group chat with unread counts.

One deployment serves one conference. The conference itself (name, dates,
timezone, airport, auto-matching schedule) is an admin-registered database row,
not a code constant. See [`docs/CONFERENCE-GENERALIZATION.md`](../CONFERENCE-GENERALIZATION.md).

---

## 2. Stack and request model

Next.js 16 App Router, React 19, TypeScript, Turbopack. Supabase cloud provides
Postgres, Auth, Realtime, and Storage. There is no separate API server: pages read
Postgres directly through PostgREST, and Row Level Security is the authorization
layer.

### The three Supabase clients

Which client a piece of code uses **is** its permission model. This is the single
most important thing to understand about the codebase.

| Client | File | Session | RLS | Used for |
|---|---|---|---|---|
| Server, cookie-bound | `lib/supabase/server.ts` → `createServerSupabase()` | the caller's | enforced | every Server Component read, most server-action writes |
| Browser | `lib/supabase/client.ts` → `createClient()` | the caller's | enforced | realtime subscriptions, avatar upload, `can_see_contact` RPC, a few client reads |
| Service role | `lib/supabase/service.ts` → `serviceClient()` | none | **bypassed** | writes that touch rows the caller does not own |

`requireUser()` in `lib/supabase/server.ts` wraps the server client and
`redirect("/login")`s when there is no session. Almost every page and server action
starts with it.

**The rule:** if a write only touches the caller's own rows, it goes through the
caller's session and RLS is the check. If it writes rows belonging to someone else
(match results, cross-user notifications, the conference row), it goes through the
service client and the check is an app-level `ADMIN_EMAIL` comparison or a cron
secret.

### Where writes live

Writes go through server actions in `app/actions/*.ts` (`"use server"`), with four
deliberate exceptions that write directly from the client or a page under RLS:

- avatar upload to Storage (`StepBasics`, `ProfileEditor`)
- `message_reads` upsert when a chat thread opens (`app/groups/[id]/chat/page.tsx`)
- `notifications.read_at` update from the bell (`NotificationBell`)
- nothing else. Reads are direct everywhere.

`middleware.ts` runs on every non-static request and calls `supabase.auth.getUser()`
purely to refresh the session cookie, which Server Components cannot do themselves.

### Routing

| Path | Kind | Notes |
|---|---|---|
| `/` | redirect | to `/home` |
| `/login`, `/forgot`, `/reset` | client pages | route group `(auth)`, no tab bar |
| `/auth/callback` | route handler | exchanges OAuth code or email token for a session |
| `/welcome` | server page | onboarding host, no tab bar |
| `/home`, `/chat`, `/matching`, `/me` | tabs | the four bottom-bar tabs (친구 / 채팅 / 매칭 / 마이페이지) |
| `/meals`, `/rides`, `/people` | tabs | still routable, reached from `/matching` and `/home` rather than the bar |
| `/groups/[id]`, `/groups/[id]/chat` | server pages | members only, 404 otherwise |
| `/admin` | server page | `ADMIN_EMAIL` only, 404 otherwise |
| `/api/cron/auto-match` | route handler | bearer `CRON_SECRET` |
| `/match-demo` | server page | standalone demo of `lib/mentorMatch.ts`, not part of the product flow |

`app/(tabs)/layout.tsx` renders the guest banner for anonymous users, the
notification bell for real users, and the tab bar.

### Environment variables

| Variable | Required | Used by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | all three clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | server and browser clients |
| `SUPABASE_SERVICE_ROLE_KEY` | yes for matching, hi, ride joins, admin | `serviceClient()` |
| `ANTHROPIC_API_KEY` | no | `matchSlot`. Missing key falls back to round-robin |
| `ADMIN_EMAIL` | yes for `/admin` | `runMatching`, `upsertConference`, `/admin` page |
| `CRON_SECRET` | yes for auto-match | `/api/cron/auto-match` |
| `AERODATABOX_API_KEY` | no | `lib/flights.ts`, currently dead code (see §7) |

---

## 3. Data model and RLS

Thirteen tables, one view, one storage bucket. Migrations `0001` through `0015` in
`supabase/migrations/`.

### Tables

| Table | Holds | Key constraints |
|---|---|---|
| `profiles` | one row per user: name, school, position, interests, bio, kakao, linkedin, dietary, photo, birthday, `event_id`, `stay_start`, `stay_end`, `mentor_optin` | PK is `auth.users.id`, cascade delete |
| `slots` | a dinner (or other) time slot: title, `starts_at`, area, `join_deadline`, `kind` | seeded by admin, no UI to create |
| `signups` | who wants which slot, plus `party_size` (1 to 6) and free-text notes | unique `(slot_id, user_id)` |
| `groups` | one matched table: name, rationale, `starter_question`, `meet_time`, `slot_id` | wiped and rewritten on every match run |
| `group_members` | membership of a table | PK `(group_id, user_id)` |
| `flights` | at most one arrival and one departure per person: airport, `scheduled_at`, luggage | unique `(user_id, direction)` |
| `ride_pools` | one carpool per posted flight: `anchor_flight_id`, direction, `pickup_at`, `capacity` (default 4) | `anchor_flight_id` unique, cascades from `flights` |
| `ride_members` | who is in a pool | PK `(pool_id, user_id)` |
| `messages` | chat, keyed by `channel_type` (`meal` or `ride`) plus `channel_id` | in the `supabase_realtime` publication |
| `message_reads` | per-user last-read timestamp per group | PK `(user_id, group_id)` |
| `hi_requests` | a one-way "hi" | unique `(from_user_id, to_user_id)` |
| `notifications` | `table_revealed`, `ride_matched`, `hi_received`, with a jsonb payload | in the `supabase_realtime` publication |
| `conferences` | the deployment's single conference plus its auto-matching schedule | `starts_at < ends_at`, `matching_interval_minutes > 0` |

Plus the view `directory_profiles` (`security_invoker = false`, so it runs as the
view owner) exposing only `id, name, photo_url, school, position, interests, bio,
stay_start, stay_end`, and the public storage bucket `avatars`.

### Security-definer helpers

These exist because a policy that reads its own table recurses. Migration `0003`
was written specifically to fix that.

| Function | Returns true when |
|---|---|
| `shares_channel(a, b)` | a and b share a `group_members` row or a `ride_members` row |
| `is_group_member(gid)` | the caller is in group `gid` |
| `can_see_contact(target)` | `shares_channel(auth.uid(), target)`, called as an RPC from `PeopleBrowser` |

### RLS matrix

`auth` means any authenticated role, which **includes anonymous guests**, since a
Supabase anonymous session also has role `authenticated`. "service" means there is
no policy at all, so only the service-role client can write.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | self **or** `shares_channel` (0008) | self | self | cascade only |
| `slots` | auth | service | service | service |
| `signups` | auth | self | **none** | self |
| `groups` | members (`g_sel`) | service | service | service |
| `group_members` | members (`is_group_member`) | service | service | service |
| `flights` | auth | self | self | self |
| `ride_pools` | auth | auth (0011) | **none** | cascade only |
| `ride_members` | auth | self | **none** | self |
| `messages` | channel members | channel members, self as author | none | none |
| `message_reads` | self | self | self | none |
| `hi_requests` | sender or recipient | self as sender, `from <> to` | none | none |
| `conferences` | **public**, no auth needed | service | service | service |
| `notifications` | self | service | self | none |
| `directory_profiles` | granted to `authenticated` | view | view | view |
| `storage.objects` (avatars) | public | own folder only | | |

The three bolded "none" cells matter. A PostgREST upsert that resolves to
`ON CONFLICT DO UPDATE` needs an UPDATE policy, and these tables do not have one.
See §7 and the flagged edge cases in [03-meals.md](03-meals.md) and
[07-rides.md](07-rides.md).

`conferences` is deliberately world-readable: the login page and root metadata read
the conference name before anyone is signed in.

---

## 4. API reference

Every server-side entry point. All server actions return a plain object, never
throw to the client.

| Entry point | File | Auth check | Writes | Returns |
|---|---|---|---|---|
| `saveProfile(fields)` | `app/actions/profile.ts` | session | `profiles` upsert (self) | `{ok, error?}` |
| `setDinnerSignups(slotIds)` | `app/actions/profile.ts` | session | `signups` insert-ignore + delete | `{ok, error?}` |
| `joinSlot(slotId, opts)` | `app/actions/signups.ts` | `requireUser` | `signups` upsert | `{ok, error?}`, errors `not_found` / `closed` / `schedule_conflict` |
| `leaveSlot(slotId)` | `app/actions/signups.ts` | `requireUser` | `signups` delete | `{ok, error?}` |
| `submitFlight(input)` | `app/actions/flights.ts` | `requireUser` | `flights` + `ride_pools` + `ride_members` | `{ok, error?}` |
| `deleteFlight(direction)` | `app/actions/flights.ts` | `requireUser` | `flights` delete, cascades | `{ok, error?}` |
| `joinRide(flightId)` | `app/actions/flights.ts` | `requireUser` | `ride_members` + `notifications` (service) | `{ok, error?, full?}` |
| `sayHi(targetId)` | `app/actions/hi.ts` | `requireUser` | `hi_requests` + `notifications` (service) | `{ok, error?}` |
| `sendMessage(type, id, body)` | `app/actions/messages.ts` | session | `messages` insert | `{ok, error?, message?}` |
| `runMatching(slotId)` | `app/actions/admin.ts` | `ADMIN_EMAIL` | `groups`, `group_members`, `notifications` (service) | `{ok, groups?, flex?, excluded?, error?}` |
| `runAllSlotsMatching(conf)` | `app/actions/admin.ts` | **none of its own** | same, per slot | `{ok, results[]}` |
| `upsertConference(fields)` | `app/actions/conference.ts` | `ADMIN_EMAIL` | `conferences` (service) | `{ok, error?}` |
| `GET /api/cron/auto-match` | `app/api/cron/auto-match/route.ts` | `Bearer ${CRON_SECRET}` | `conferences.last_auto_match_at` plus everything above | JSON |
| `GET /auth/callback` | `app/auth/callback/route.ts` | public by design | none | 302 |

`runAllSlotsMatching` is exported from a `"use server"` file and performs no auth
check of its own. It is only ever called from the cron route, which does check the
secret, but it is nonetheless a callable server action. Flagged in §7.

### Pure functions worth testing directly

These have no I/O and are where most of the unit tests already live (88 tests
across 7 files, `npm test`).

| Function | File | Tests |
|---|---|---|
| `validateAssignment`, `roundRobinGroups`, `repackInvalid`, `buildMatchPrompt` | `lib/matching.ts` | 26 |
| `isEligibleForSlot` | `lib/scheduleFilter.ts` | 5 |
| `shouldAutoMatch` | `lib/autoMatch.ts` | 10 |
| `nameGroup`, `nameGroups` | `lib/groupName.ts` | 8 |
| `stayRelation` | `lib/stay.ts` | 9 |
| `bucketIntoPools`, `delayMinutes` | `lib/flights.ts` | 11 (dead code, see §7) |
| `classify`, `assignMentees`, `suggestGroups` | `lib/mentorMatch.ts` | 19 (demo only) |
| `toLocalInput` | `lib/rides.ts` | none |
| `getConference` | `lib/conference.ts` | none |

---

## 5. The flows

Ten flows. Each block is enough to understand what happens; the linked file has the
step tables, the exact code paths, and the numbered edge cases.

### Auth → [01-auth.md](01-auth.md)

Four ways in: email and password, Google OAuth, a password reset link, and an
anonymous guest session. `/login` is one client component with a `signin` / `signup`
mode toggle. Sign-up either returns a session immediately (confirmation disabled) or
sends a confirmation mail and shows a resend button on a 30-second cooldown. Google
and recovery links both land on `/auth/callback`, which exchanges the code or token
for a session and then branches: recovery goes to `/reset`, everyone else goes to
`/home` if a `profiles` row exists and `/welcome` if it does not. That profile check
is the only thing routing new users into onboarding.

The non-obvious part: sign-up with an already-registered email does not error.
Supabase returns a decoy user with an empty `identities` array and sends no mail, so
the code detects that and flips the form back to sign-in rather than showing a
dead-end "check your inbox".

Guests get a real Supabase anonymous session, so they pass every `auth.role() =
'authenticated'` policy. They are held back by app-level `user.is_anonymous` checks
on `/me`, `/home`, and the Meals join button, plus a sticky `GuestBanner`.

### Onboarding → [02-onboarding.md](02-onboarding.md)

Five steps at `/welcome?step=N`, hosted by one client component holding all the
state. Step 1 event and stay dates, step 2 name / school / position / birthday /
photo, step 3 interests, step 4 bio and contacts, step 5 dinners and flights.

Two things make this flow specific. First, only `step` lives in the URL; all field
data lives in React state that is mirrored to `localStorage` under
`onboarding-draft` on every keystroke, so a refresh or a backgrounded tab does not
lose the draft. It is cleared only on a successful finish. Second, each step saves
to `profiles` as you leave it, so a user who abandons at step 3 still has a partial
profile and will not be sent back to `/welcome` on next login.

Finish does three things in sequence: `saveProfile({dinners_wanted})`,
`setDinnerSignups(slotIds)` to reconcile signups, then `submitFlight` for whichever
of arrival and departure was filled. The flight calls are deliberately non-fatal.

### Meals → [03-meals.md](03-meals.md)

`/meals` (also embedded in `/matching`) lists every `kind = 'meal'` slot with a
headcount that sums `party_size`, so a party of 3 counts as 3. The action button has
three states: **Join** opens `JoinSheet`, **Going** opens the lighter `GoingSheet`,
**Closed** when `join_deadline` has passed.

The non-obvious part is the join round-trip. `joinSlot` first checks the deadline,
then, unless `confirmed` is true, checks `isEligibleForSlot` against the user's stay
window and returns `schedule_conflict` instead of writing. The sheet catches that,
shows "You're leaving before this one, still join?", and the second press sends
`confirmed: true`. This is why `MealsList` awaits the server before touching UI
state rather than being optimistic: an optimistic close would have to un-close.

Leaving, by contrast, is optimistic and rolls back on failure.

### Matching → [04-matching.md](04-matching.md)

The core algorithm. One function, `matchOneSlot` in `app/actions/admin.ts`, is the
only matching pipeline; both the admin button and the cron call it.

1. Read every signup for the slot with its profile joined.
2. **Hard schedule filter.** `isEligibleForSlot` drops anyone with no `event_id`
   (they picked "just exploring") or whose stay window does not cover the slot
   date. Interest fit never overrides a schedule conflict. Excluded people are left
   ungrouped, not deleted.
3. **LLM pass.** `matchSlot` sends the roster to Claude with a forced
   `submit_groups` tool call, up to 2 attempts, validating after each.
4. **Validation.** `validateAssignment` checks the partition: no duplicates, nobody
   missing, nobody invented, and every table's **headcount** (sum of party sizes,
   not row count) within 4 to 6. Oversize is fatal, undersize is only reported.
5. **Repack, not discard.** If validation fails, `repackInvalid` keeps the tables
   that were already fine and re-packs only the flagged ones with
   `roundRobinGroups`, a balanced first-fit-decreasing bin packer that never splits
   a party. A broken partition (lost or duplicated users) is the exception: nothing
   in it can be trusted, so everyone gets repacked.
6. **Naming.** `nameGroups` draws a themed name from `data/group-names.json` based
   on shared interests, but only for tables the LLM actually matched. Round-robin
   tables keep "Table N" so a themed name never contradicts an honest "grouped to
   keep tables even" rationale. Provenance is tracked by comparing the rationale
   string to the exported `ROUND_ROBIN_RATIONALE` constant.
7. **Write.** Delete all groups for the slot (cascading `group_members`), insert the
   new ones, insert members, then fan out one `table_revealed` notification per
   seated member. All through the service client. Re-running is idempotent by
   destruction, which also means it is not atomic: a failure between the delete and
   the insert leaves the slot with no tables.

Falls back to `roundRobinGroups` entirely if the Anthropic call throws, which is
what happens when `ANTHROPIC_API_KEY` is unset.

### Auto-match → [05-auto-match.md](05-auto-match.md)

`GET /api/cron/auto-match` checks a bearer `CRON_SECRET`, loads the conference, and
asks the pure function `shouldAutoMatch(conference, now)` whether to run. That gate
requires all of: a conference exists, `auto_matching_enabled`, now is within
[starts_at minus 7 days, ends_at], and at least `matching_interval_minutes` have
passed since `last_auto_match_at`. If it passes, `runAllSlotsMatching` loops every
slot through `matchOneSlot` sequentially, then stamps `last_auto_match_at`.

The schedule in `vercel.json` is daily (`0 0 * * *`), while the code comments assume
the tick fires at least as often as the shortest configurable interval. Real gap,
documented in §7.

### Group reveal and chat → [06-groups-chat.md](06-groups-chat.md)

`/groups/[id]` shows the table: name, rationale, icebreaker question, meet time, and
a member card each with school, position, interests, and contacts. Access control is
pure RLS: a non-member's query returns null and the page calls `notFound()`. First
visit animates a staggered reveal, tracked in `localStorage` per group id, so it
never replays.

`/groups/[id]/chat` upserts `message_reads` on load (that is what clears the unread
badge), loads the last 100 messages, and subscribes to a realtime
`postgres_changes` INSERT filter on `channel_id`. Sending is optimistic: a `tmp-`
row appears immediately, `sendMessage` returns the real row, and it is swapped in by
id. The realtime handler dedupes by id so a message never appears twice. Failed
sends stay in place marked failed with a retry.

`/chat` is the thread index. It computes unread by counting messages newer than
`message_reads.last_read_at`, in application code rather than SQL, and shows all
messages as unread when there is no read row.

### Rides → [07-rides.md](07-rides.md)

Flights are captured at onboarding step 5 and edited on `/me`; there is no separate
add-flight screen. `submitFlight` does three writes: upsert the flight (parsing the
wall-clock `datetime-local` string with the conference's fixed `utc_offset`), upsert
a `ride_pools` row anchored to that flight, and seat the poster in it.

The board at `/rides` lists every posted flight for the conference airport, split
into Arrivals and Departures. If you have posted your own flight, everyone within 30
minutes of it is highlighted. **Share** calls `joinRide`, which re-reads the pool's
current member count and refuses at `capacity` (4), then notifies every rider
already in the pool through the service client.

Names on the board come from `directory_profiles`, not a `profiles` join, because
most posters do not yet share a channel with the viewer and `profiles` RLS would
return nothing.

### People and Say hi → [08-people-hi.md](08-people-hi.md)

`/people` (also embedded in `/home`) reads `directory_profiles`, which exposes only
public columns. Filtering is entirely client-side across four axes: free-text search
on name and school, interest chip, school chip, and stay window.

The stay badge comes from `stayRelation`, a pure comparison of two date ranges
returning `early` / `late` / `same` / `no-overlap` / null, where null means one side
has no dates and the badge is hidden.

Contacts are the interesting part. Opening someone's sheet calls the
`can_see_contact` RPC; only if it returns true does the client read `kakao` and
`linkedin`. Migration `0008` made that a real gate at the database level rather than
a client-side courtesy. "Say hi" writes a `hi_requests` row and notifies, but
deliberately does **not** unlock contacts. A duplicate hi returns `23505` and is
treated as success.

### Notifications → [09-notifications.md](09-notifications.md)

Three types, all written by the service client because in every case the actor is
not the recipient: `table_revealed` (fan-out at the end of a match run),
`ride_matched` (to existing riders when someone joins), `hi_received`.

`NotificationBell` renders in the tab layout for signed-in non-guests. It loads the
30 most recent, subscribes to realtime INSERTs filtered on its own `user_id`, and
"Mark all read" updates optimistically then writes. Each type maps to a fixed copy
string and destination href.

### Admin and conference → [10-admin-conference.md](10-admin-conference.md)

`/admin` 404s for anyone whose email is not `ADMIN_EMAIL`. It holds two things: the
conference registration form and one row per slot with a "Run matching" button
reporting group count, whether any table is under 4 by headcount, and how many
people were excluded on schedule.

`upsertConference` re-checks `ADMIN_EMAIL` server-side, validates name, date order,
and interval, then writes through the service client because `conferences` has no
write policy. Passing an `id` edits, omitting it inserts. `getConference` reads the
most recently created row, which makes it a de-facto singleton without a database
constraint.

---

## 6. Cross-cutting rules

**Auth gate.** `requireUser()` redirects to `/login` when there is no session. Every
tab page, group page, and most server actions start with it. It does not distinguish
guests from real users; that is a separate `user.is_anonymous` check.

**Guest restrictions.** Anonymous users pass RLS but are blocked in the UI: `/me`
renders `SignupGate` instead of the profile, `/home` renders a guest variant, and
Meals routes the Join button to `/login`. `/people` is fully browsable.

**Conference lookup.** `getConference(supabase)` is called by nearly every page. It
returns null when nothing is registered, and every consumer has a fallback: the
kicker falls back to "Icebreaker", the timezone to `America/New_York`, the UTC
offset to `-04:00`, the airport filter is skipped entirely.

**Time.** Two different mechanisms on purpose. `timezone` (an IANA id) is used with
`Intl.DateTimeFormat` for all display, which handles DST correctly. `utc_offset` (a
fixed string like `-04:00`) is used only to parse a `datetime-local` input into an
instant in `submitFlight`. `toLocalInput` in `lib/rides.ts` converts back.

**Notification fan-out.** Any write whose notification targets someone other than
the caller uses `serviceClient()`. These inserts are best-effort and never fail the
parent operation.

**Idempotency.** `runMatching` is idempotent by deleting first. `sayHi` is
idempotent via the unique constraint. `joinRide` and `setDinnerSignups` use
insert-ignore. `submitFlight` upserts on a unique key.

**Error convention.** Server actions return `{ok: false, error}` rather than
throwing. A few errors are machine-readable sentinels the UI branches on:
`schedule_conflict`, `closed`, `not_found`, `forbidden`.

**Degrading on a missing table.** Several pages were written to survive an unapplied
migration: `/people` retries `directory_profiles` without the stay columns, `/me`
tolerates a missing `flights` table, `/rides` treats a query error as an empty
board. This is why some flows fail silently rather than loudly against the current
database. See §7.

---

## 7. Current state and known gaps

**Migrations 0008 to 0015 are not applied to the live Supabase project.** Verified
against PostgREST: `conferences`, `notifications`, `message_reads`, `hi_requests`
return 404, and `profiles.stay_start`, `ride_pools.anchor_flight_id`,
`groups.starter_question` return 400. Until `npx supabase db push` runs, these
break against live data:

| Surface | Why |
|---|---|
| `/chat` | `message_reads` missing |
| `/matching`, `/rides` join | `ride_pools.anchor_flight_id` missing |
| Say hi | `hi_requests` missing |
| Notification bell | `notifications` missing |
| Onboarding steps 1 and 5 | `profiles.stay_start` / `stay_end` missing |
| Group reveal, chat empty state | `groups.starter_question` missing |
| Conference everywhere | `conferences` missing, so every page uses its fallback |

**Three upserts have no matching UPDATE policy.** These need verifying against a
migrated database before being treated as confirmed bugs, but the policy files say
what they say:

- `joinSlot` upserts `signups` with a plain `onConflict`, which is
  `ON CONFLICT DO UPDATE`. `signups` has `su_sel`, `su_ins`, `su_del` and no update
  policy. Editing an existing signup ("Save changes" in `JoinSheet`) is the affected
  path. See `MEAL-E09`.
- `submitFlight` upserts `ride_pools` on `anchor_flight_id` without
  `ignoreDuplicates`. `ride_pools` has `rp_sel` and `rp_ins` and no update policy.
  Re-submitting a flight, which is what editing your flight time on `/me` does, is
  the affected path. See `RIDE-E06`.
- `ride_members` likewise has no update policy, but both call sites pass
  `ignoreDuplicates: true`, which compiles to `DO NOTHING` and needs only INSERT. Not
  affected.

**The cron schedule and the configured interval disagree.** `vercel.json` fires
`/api/cron/auto-match` once a day at `0 0 * * *`. `matching_interval_minutes`
defaults to 360 and accepts any positive integer, and the route comment states the
tick "needs to fire at least as often as the shortest interval an admin might
configure". As shipped, auto-matching runs at most once per day no matter what the
admin sets. Not changed here.

**`runAllSlotsMatching` has no auth check.** It is a `"use server"` export with no
`ADMIN_EMAIL` or secret comparison, unlike its sibling `runMatching`. The only
caller is the authenticated cron route, but Next.js server actions are individually
invocable.

**`runMatching` is not atomic.** It deletes all groups for a slot before inserting
the new ones. Any failure in between leaves the slot with no tables at all.

**Dead code.** `lib/flights.ts` (the AeroDataBox arrivals integration,
`bucketIntoPools`, `fetchArrivals`) is imported by nothing except its own 11 tests.
The live rides board does its own 30-minute windowing in `Board.tsx`.
`lib/mentorMatch.ts` is **not** dead: `app/match-demo/page.tsx` still imports it,
even though the mentor product feature was removed.

**Two carried-over regressions.** `SignupGate` hardcodes `href="/login"` and the
login page never reads a `next` param, so a guest who hits the gate on `/me` lands
on `/home`. And the rides carpool highlight `.arr-hot` is a 7% wash measuring 1.07:1
against the background, effectively invisible.

---

## 8. Test-ID scheme

Every edge case in the detail docs carries a stable id, `<AREA>-E<nn>`, so a test
name can cite it directly and a reader can find the case from the test.

| Prefix | Area | File |
|---|---|---|
| `AUTH` | sign-in, sign-up, reset, guest, callback | [01-auth.md](01-auth.md) |
| `ONB` | onboarding steps and draft | [02-onboarding.md](02-onboarding.md) |
| `MEAL` | slot list, join, leave, sheets | [03-meals.md](03-meals.md) |
| `MATCH` | the matching pipeline | [04-matching.md](04-matching.md) |
| `CRON` | auto-match gate and loop | [05-auto-match.md](05-auto-match.md) |
| `CHAT` | reveal, chat, unread | [06-groups-chat.md](06-groups-chat.md) |
| `RIDE` | flights, pools, joins | [07-rides.md](07-rides.md) |
| `PPL` | directory, filters, contacts, hi | [08-people-hi.md](08-people-hi.md) |
| `NOTIF` | notifications | [09-notifications.md](09-notifications.md) |
| `ADMIN` | admin and conference | [10-admin-conference.md](10-admin-conference.md) |

Ids are never reused or renumbered. A case that stops applying is marked resolved
rather than deleted.

Each edge-case table has four columns: **id**, **case**, **expected**, and
**verified**, where verified is one of:

- `unit`: a test in `lib/*.test.ts` covers it today
- `code`: the behavior is visible in the code but has no test
- `flag`: the expected behavior is stated but suspected wrong, needs checking
  against a migrated database
