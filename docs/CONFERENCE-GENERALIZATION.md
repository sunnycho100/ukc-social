# Conference generalization + auto-matching scheduler

Generalizes Icebreaker off a single hardcoded conference ("UKC 2026") into an
admin-registered configuration, and adds a scheduler so dinner-table matching can run
automatically instead of only via the admin's manual "Run matching" button.

## Why

The app was built for exactly one conference: "UKC 2026" was a literal string in five
tab pages, the login page, root metadata, and even the LLM matching prompt, and
`lib/rides.ts` hardcoded the event's airport (`MCO`) and UTC offset (`-04:00`). Forking
this repo for a different conference meant hand-editing source in ~10 places. Matching
was also 100% manual — an admin had to remember to click "Run matching" on every slot,
which doesn't scale once a team is running this for real and can't babysit `/admin`.

## What shipped

### 1. Conference registration (`/admin`)

- **Migration `supabase/migrations/0012_conference.sql`** — new `conferences` table:
  `name`, `location`, `starts_at`/`ends_at`, `timezone` (IANA id, for display
  formatting), `utc_offset` (fixed offset string, for parsing wall-clock flight times —
  same trick the old hardcoded `EVENT_OFFSET` used), `airport_code`,
  `auto_matching_enabled`, `matching_interval_minutes`, `last_auto_match_at`. Public
  `select` RLS (name/dates/location aren't sensitive, and the login page/root metadata
  need to read it while logged out); all writes go through the service-role client
  after an `ADMIN_EMAIL` check, same pattern `runMatching` already used.
- **`lib/conference.ts`** — `getConference(supabase)`, the one place every page/action
  reads the row from (most-recently-created row; a deployment/fork has one in
  practice, but it's a real table, not a code constant).
- **`app/actions/conference.ts`** — `upsertConference()` server action, admin-gated,
  validates `starts_at < ends_at` and a positive matching interval. Update-by-id if a
  row already exists, else insert — a de-facto singleton without a DB constraint, so
  "re-registering" is just editing the one row.
- **`components/AdminConferenceForm.tsx`** — the registration/edit form on `/admin`,
  above the existing per-slot matching rows. Shows a computed "auto-matching window
  opens {starts_at − 7d}" / "last run: …" status line.

### 2. Hardcoded "UKC" removed

Every literal "UKC 2026" and hardcoded timezone/airport/offset constant now reads from
the registered conference, with a generic fallback ("Icebreaker" / plain copy /
`America/New_York`) when none is registered yet:

- Tab kickers/eyebrows: `home`, `people`, `meals`, `me`, `rides` pages.
- Root metadata description (`app/layout.tsx`, now an async `generateMetadata()`).
- Login page subtitle (`app/(auth)/login/page.tsx`, fetched client-side on mount).
- Onboarding Step 1 (`components/onboarding/StepEvent.tsx`) — was a hardcoded
  `ukc2026`/`ksea2026`/`none` picker; now a single card for whatever conference is
  registered (name/dates/location), plus "None of these." `EventChoice` narrowed to
  `"attending" | "none"`.
- The LLM matching prompt (`lib/matching.ts`) — hardcoded "UKC 2026 conference
  attendees" / "near ChampionsGate FL" is now `buildMatchPrompt()` (extracted as a
  pure, unit-tested function) interpolating the conference's name/location.
- `lib/rides.ts`'s `EVENT_AIRPORT`/`EVENT_OFFSET` constants are gone; `toLocalInput()`
  takes a `timezone` param instead. Every display formatter that hardcoded
  `timeZone: "America/New_York"` (`home`, `rides`, `me`, `meals` pages,
  `GroupReveal`, `Chat`, `MealsList`, `JoinSheet`, onboarding's `StepPlans`) now takes
  the conference's timezone as a prop, falling back to `America/New_York` if unset.
- Two internal `localStorage` keys (`"ukc-onboarding"`, `"ukc-theme"`) renamed to
  `"onboarding-draft"` / `"theme"` — not user-facing, but no reason to keep the name.

**Deliberately left alone** (dev/test-only, no product-facing benefit to renaming):
`scripts/seed-fake.ts`'s `@ukctest.dev` fake emails, `scripts/e2e/*.mjs`, and
`data/example-arrivals-mco-2026-08-04.json`'s note field.

### 3. Auto-matching scheduler

- **`lib/autoMatch.ts`** — `shouldAutoMatch(conference, now)`, a pure gate: false if no
  conference, `auto_matching_enabled` is off, more than 7 days before `starts_at`, past
  `ends_at`, or the configured interval hasn't elapsed since `last_auto_match_at`. Kept
  pure and separate from any network/DB code specifically so it's fully unit-testable
  (see Verification below).
- **`app/actions/admin.ts`** refactored: the per-slot matching pipeline (fetch signups
  → LLM match → validate → round-robin fallback → name tables → wipe/insert
  groups+members) is now `matchOneSlot()`, shared by the existing manual
  `runMatching(slotId)` and the new `runAllSlotsMatching(conference)` (loops every
  slot) — one matching pipeline, not two copies.
- **`app/api/cron/auto-match/route.ts`** — checks a bearer-token `CRON_SECRET`, loads
  the conference, calls `shouldAutoMatch`; if true, runs `runAllSlotsMatching` and
  stamps `last_auto_match_at`.
- **`vercel.json`** — registers the route on a daily Vercel Cron tick (`0 0 * * *`).
  The actual admin-configured interval (e.g. "every 6 hours") is enforced *inside*
  the route by `shouldAutoMatch`, not by this schedule.
  **Correction from an earlier draft of this doc**: Vercel's Hobby plan doesn't just
  throttle a too-frequent cron schedule down to daily — it **rejects the deployment
  outright** ("Deployment failed", confirmed live: an hourly schedule broke every
  deploy on this project's Hobby plan from this point on). `vercel.json` is set to
  daily to actually deploy on Hobby; on Pro, tighten the schedule (e.g. hourly) to
  let sub-daily admin-configured intervals actually fire that often.
- New env var: `CRON_SECRET` (added to `.env.example`) — must match what's configured
  as the Cron job's bearer token in Vercel.

## Verification

Ran from a clean working tree after all changes above:

```
$ npm test
 Test Files  6 passed (6)
      Tests  52 passed (52)
```
6 files: existing `lib/matching.test.ts` (extended with 3 new `buildMatchPrompt` cases),
`lib/mentorMatch.test.ts`, `lib/stay.test.ts`, `lib/groupName.test.ts`,
`lib/flights.test.ts` (all pre-existing, unaffected), plus new `lib/autoMatch.test.ts`
(8 cases covering every branch of `shouldAutoMatch`: no conference, disabled, >7 days
out, exactly at the 7-day boundary, never-run-yet, interval not elapsed, interval
elapsed, conference already ended).

```
$ npx tsc --noEmit
(clean, no output)

$ npm run build
✓ Compiled successfully
✓ Generating static pages (17/17)
```
17 routes built successfully, including the new `/api/cron/auto-match`.

```
$ npm run lint
```
21 errors / 1 warning both before and after this change (confirmed by stashing and
re-running) — all pre-existing (unrelated `any` types, ref/setState-in-render rules on
code this pass didn't touch). **This pass introduced zero new lint errors.**

**Not done this pass — requires a human with live Supabase dashboard access**:
- Migration `0012_conference.sql` has not been applied to the live project
  (`kxvvnvzfdawsnftgjabl`) — same manual SQL-editor step every prior migration in this
  repo needed (there's no DB password available to this session, only the API keys, so
  it can't be scripted here).
- No conference is registered yet, so a live click-through of `/admin`'s new form, the
  updated onboarding Step 1, and a real `curl` against `/api/cron/auto-match` (with a
  real `CRON_SECRET`) haven't been run against live data. Once the migration is
  applied: register a conference from `/admin`, confirm the "UKC 2026" strings are
  gone from `/home`, `/people`, `/meals`, `/rides`, `/me`, `/login`, and that onboarding
  Step 1 shows the registered conference instead of the old hardcoded picker.
- `CRON_SECRET` isn't set in `.env.local` or Vercel yet.

## For a team forking this repo

1. Apply all migrations through `0012` to your Supabase project.
2. Set `CRON_SECRET` in `.env.local` (and in Vercel's env vars for production) and
   configure Vercel Cron to call `/api/cron/auto-match` with that value as a bearer
   token (see `vercel.json`).
3. Sign in as `ADMIN_EMAIL` and register your conference at `/admin` — name, location,
   start/end dates, timezone, airport code. Turn on auto-matching and set an interval
   whenever you're ready; it won't do anything until 7 days before your `starts_at`.
