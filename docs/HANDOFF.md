# Icebreaker (formerly UKC Social) — Handoff / Status

_Last updated: 2026-07-30 (LLM "suggested place" replaced with an icebreaker question)_

### Update — 2026-07-30 Dropped the LLM-invented "suggested place," added an icebreaker question

`suggestedPlace` was pure creative text generation — `buildMatchPrompt` just asked
Claude for "a suggested cuisine near X," with no real venue or reservation data behind
it. That's exactly why it produced ungrounded, occasionally nonsensical results (a
coffee-shop-sounding name suggested for a dinner slot, previously reproduced). Where
to actually eat is now left to the table to sort out themselves in chat.

- **Migration `0015_group_starter_question.sql`**: `groups.suggested_place` renamed to
  `starter_question`. **Not yet applied to the live Supabase project** — joins
  `0011`–`0014` in the "Remaining Human TODOs" backlog below.
- `lib/matching.ts`: `MatchGroup.starterQuestion` replaces `suggestedPlace`; the
  now-unused `location` param dropped from `buildMatchPrompt`/`matchSlot` (it only
  ever existed to build the "near X" phrase). Prompt now asks for "a fun icebreaker
  question the table could open with — grounded in what they actually have in
  common, not generic small talk." Round-robin/repacked tables still get an honest
  empty string (no starter question), consistent with their plain name + generic
  rationale.
- Every surface that showed a place now shows a "💬 Break the ice" question instead:
  `GroupReveal.tsx`, Home's `Revealed`/`DayOf`/per-table cards
  (`app/(tabs)/home/page.tsx`), and `Chat.tsx`'s empty state. `Chat.tsx`'s `meetLine`
  simplified to time-only (place was the other half of that line).
- `lib/matching.test.ts`: renamed fixtures, added a regression guard —
  `buildMatchPrompt`'s output must mention "icebreaker question" and must NOT mention
  "cuisine" or "suggested place." Test count: 87 → 88.
- Verified: `tsc`, `npm test` (88/88), `npm run lint` (21 errors + 1 warning — matches
  the pre-existing baseline exactly), `npm run build` (all 19 routes), dev-server
  smoke check.

### Update — 2026-07-29 People's filtering brought back onto 친구 (Home)

Moving People off the bottom tab bar (the nav restructure below) left its stay-badge
(early/late/same) and interest filtering reachable only via one link from Home, and
not reachable at all from 채팅/매칭/마이페이지. Requested back explicitly.

- `components/PeopleBrowser.tsx`: added a school filter (chips, same pattern as the
  existing interest chips) — filtering previously covered stay window and interest
  only, not school, despite school being a core directory field.
- `app/(tabs)/people/page.tsx`: extracted `PeopleSection()` (data fetch +
  `<PeopleBrowser>`), same shared-section pattern already used for Meals/Rides, so
  `/people` and Home read from one implementation, not a copy.
- `app/(tabs)/home/page.tsx`: embeds `PeopleSection` directly under "Line these up" —
  the full stay/interest/school browsing experience is back on 친구 itself now, not
  just linked from it.

### Update — 2026-07-29 UI polish pass (user-reported rough edges)

- **Kicker duplication fixed.** Every tab's small kicker label was falling back to
  its own page title when no conference is registered — which is the live app's
  actual current state, so every tab showed a literal duplicate header (e.g. "Me"
  over "Me", and `/chat` hardcoded a Korean "채팅" over an English "Chat" title). All
  kickers now fall back to "Icebreaker" instead, matching what Home already did.
- **NotificationBell desktop position simplified.** The previous desktop placement
  (`bottom: 84px`, guessed to sit above 마이페이지 in the rail) was never actually
  anchored to the rail's real layout. Simplified to top-right on every breakpoint —
  it never collides with a left-side rail regardless of width, so there's no second
  position to keep in sync.
- **Flight editing merged into Edit profile.** Editing arrival/departure flight times
  was a second, always-open "My flights" section on Me with its own separate Save
  button, disconnected from the "Edit profile" flow. Flight fields now live inside
  the same edit form and save together with one Save button; the read view shows a
  compact flight summary line. `components/FlightEditor.tsx` deleted. Also fixed its
  hardcoded 2026 default flight dates — now derived from the registered conference's
  own dates, same pattern already used in onboarding's `StepPlans`.

### Update — 2026-07-29 Vercel deployment was silently broken since the conference-gen push

Every deploy since `9f8a5ca` (conference generalization + auto-matching, the first
commit in today's four-phase pass) was failing on Vercel — confirmed live via the
GitHub commit-status check ("Deployment failed") and the Deployments tab, which
showed the last **successful** deploy stuck at `42f6f27` (the commit right before
this session started) while every commit after it errored.

- **Root cause**: `vercel.json`'s cron schedule (`"0 * * * *"`, hourly) — Vercel's
  Hobby plan doesn't quietly cap an hourly cron down to daily execution the way the
  earlier write-up in this doc and `docs/CONFERENCE-GENERALIZATION.md` assumed. It
  **rejects the deployment outright**. That assumption was wrong and is corrected in
  both docs now.
- **Fix**: `vercel.json`'s schedule changed to `"0 0 * * *"` (daily) — deploys on
  Hobby again. The admin-configured `matching_interval_minutes` is still enforced
  *inside* `app/api/cron/auto-match` by `shouldAutoMatch()`, independent of this
  schedule; on Pro, the schedule itself could be tightened (e.g. hourly) so a
  sub-daily admin interval actually gets to fire that often.
- **How this was diagnosed**: user reported Vercel only showing a build from ~19h
  ago; checked `git log` on both remotes (`fork` = this repo, had all 5 commits;
  `origin` = the original upstream, stale since 2026-07-23 — ruled out as unrelated);
  user confirmed via GitHub's commit-status check that Vercel deployments were
  attempted and failing, not simply not triggered.
- **Not yet confirmed**: whether this was the *only* deploy blocker — waiting on the
  next deploy attempt to confirm green before calling this fully resolved.

### Update — 2026-07-29 Algorithm test hardening pass

Went through every pure algorithm module in `lib/` (`groupName`, `stay`, `flights`,
`matching`, `mentorMatch`, `autoMatch`) writing deliberately adversarial edge-case
scenarios, not just happy-path coverage. Test count: 52 → **78**. One real bug found
and fixed; everything else was either confirmed-correct-and-now-locked-in via a
regression test, or confirmed-as-a-known-gap and logged (not silently patched).

- 🐛 **Bug fixed — `lib/groupName.ts`'s `nameGroup()`.** `majority = Math.ceil(n / 2)`
  was `0` for an empty member list, and every category's hit-count (also `0` for zero
  members) trivially satisfied `hits >= majority`. An **empty group would confidently
  get a themed vibe name** (e.g. "Send It" — a climbing name) with zero members
  actually backing it, instead of falling through to "mixed." Fixed by flooring
  majority at 1 (`Math.max(1, Math.ceil(n / 2))`). Currently unreachable from the live
  app (`matchOneSlot` in `app/actions/admin.ts` returns early on zero signups before
  `nameGroups` is ever called), but `nameGroup`/`nameGroups` are exported, general-
  purpose functions — this was a real landmine for the next caller. Regression tests
  in `lib/groupName.test.ts`.
- **Found, logged, not changed — `lib/matching.ts`'s `validateAssignment`.** Its own
  comment calls oversize (> max) "a hard fail," but nothing upstream actually enforces
  that: an indivisible party bigger than `max` (e.g. a solo signup with `party_size:
  7`) still produces exactly the table you'd expect from `roundRobinGroups`, and
  `matchOneSlot` inserts it regardless of `validateAssignment`'s `ok: false` — there's
  no split/reject path, nor could there sensibly be one (a party can't be split
  across tables). Test added (`lib/matching.test.ts`) to document this as intentional
  current behavior rather than leave it an implicit assumption. Worth a product call
  if it ever comes up for real (warn the admin? cap party size at signup?).
- New coverage, no bugs found (confirms existing behavior is correct, locks it in
  against regressions): `lib/stay.ts`'s early/late precedence when a stay bookends the
  viewer's whole window, partial-null dates, and a month-boundary comparison;
  `lib/flights.ts`'s AeroDataBox live-API normalization path (`fetchArrivals` mocked
  via `vi.stubGlobal("fetch", …)` — **previously had zero test coverage** for the
  cancelled/landed/delayed/scheduled status inference and flight-number whitespace
  stripping), empty/all-cancelled arrival lists, and the "anchor to first arrival, not
  a sliding window" bucketing behavior; `lib/matching.ts`'s lone-oversized-party and
  two-oversized-parties cases (confirmed no phantom empty-member groups leak through,
  which would otherwise insert broken zero-member tables into the DB);
  `lib/mentorMatch.ts`'s zero-mentor/zero-mentee/empty-roster inputs, tag
  de-duplication in `jaccard`, and the affinity-floor boundary being inclusive
  (`affinity === floor` still fuses).
- `npm test` (78/78), `npx tsc --noEmit`, and `npm run build` (17/17 routes) all clean.

### Update — 2026-07-29 Conference generalization + auto-matching scheduler

Full write-up (feature list + test/verification results, meant to be shared as-is):
`docs/CONFERENCE-GENERALIZATION.md`. Short version:

- New `conferences` table (migration `0012_conference.sql`) + `/admin` registration
  form (`AdminConferenceForm`, `app/actions/conference.ts`) — a fork/deployment now
  configures its own name/location/dates/timezone/airport from the UI instead of
  hardcoded "UKC 2026" constants scattered across the app.
- Every hardcoded "UKC 2026" string and `America/New_York`/`MCO`/`-04:00` constant is
  now sourced from that row (with a generic/`America/New_York` fallback where none is
  registered yet). Deliberately left alone: `scripts/seed-fake.ts`'s `@ukctest.dev`
  fake emails, `scripts/e2e/*.mjs`, and the bundled example arrivals JSON — dev/test
  fixtures, not product surface.
- Matching can now run on a schedule: `auto_matching_enabled` +
  `matching_interval_minutes` on the conference row, a pure `shouldAutoMatch()` gate
  (`lib/autoMatch.ts`, unit tested), and `app/api/cron/auto-match` (bearer-token
  protected via `CRON_SECRET`) wired to Vercel Cron (`vercel.json`, daily tick — the
  admin-configured interval is enforced inside the route). **Vercel Hobby caveat**
  (corrected below): a too-frequent schedule doesn't just get throttled, it breaks
  the deploy outright — `vercel.json` is set to daily so it actually ships on Hobby.
- `runMatching()` (the manual per-slot admin button) and the new `runAllSlotsMatching()`
  (used by the cron route) now share one matching pipeline (`matchOneSlot()` in
  `app/actions/admin.ts`) — no duplicated logic between the manual and scheduled paths.
- **Not done this pass — needs a human with Supabase dashboard access**: migration
  `0012` has not been applied to the live project (`kxvvnvzfdawsnftgjabl`); no
  conference is registered yet, so today every page falls back to its generic/default
  copy. `CRON_SECRET` also isn't set anywhere yet (Vercel env vars + local
  `.env.local`). Same manual-application pattern as every prior migration in this repo.

### Update — 2026-07-29 Rides "Share" → real ride-pool join

Rides' "Share" button was a `useState`-only stub (fixed to stop *lying* about it in an
earlier pass, but still didn't do anything). It's now a real join, reusing `ride_pools`/
`ride_members` — tables that existed since `0001` but nothing ever wrote to:

- `submitFlight()` now opens (or reuses) the posted flight's own pool and seats the poster
  in it. Migration `0011` adds `ride_pools.anchor_flight_id` (unique, → `flights`) plus the
  missing insert policy (`0001` only ever granted `select` on `ride_pools`).
- New `joinRide(flightId)` action: finds the flight's pool, checks the member count against
  `ride_pools.capacity` (default 4), and either seats the joiner or returns `full`. The
  board hides the join action and shows "Full" once capacity's hit — "join, closes at 4,"
  no separate pool-creation step for users to think about.
- Side effect, not additional code: `shares_channel()` already checked `ride_members` for
  contact-unlock (`0008`) — it just never had real rows to find. Sharing a ride now unlocks
  contacts the same way sharing a meal table does.
- Verified live: two accounts, poster posts a flight, joiner clicks Share on the real
  board, DB shows a 2-member pool at capacity 4, UI shows "Joined ✓" for the joiner and
  "Posted" unchanged for the poster.

Migration `0011_ride_join.sql` needs to be applied to the live Supabase project (same
manual step as the others).

### Update — 2026-07-29 verified live end-to-end on a fresh Supabase project

Applied all 10 migrations to a brand-new project (`kxvvnvzfdawsnftgjabl`) and drove the real
app with Playwright against it (magic-link login via `supabase.auth.admin.generateLink`, no
mocking) — not just code tracing this time:

- Full 5-step onboarding (Event & stay → Basics → Interests → Contact & bio → Plans+flight),
  including clicking Back from step 2 back to step 1 to confirm last session's fix holds.
- Joined a real dinner slot; the join sheet's new "Tables revealed" line rendered correctly.
- Ran `/admin` matching for real (22 signups → 4 groups); round-robin fallback fired since
  `ANTHROPIC_API_KEY` wasn't set for this project — rationale correctly read the generic
  "Grouped to keep tables even." — but the table still got a real bank name ("The Grind",
  from the shared "Coffee chat" vibe), confirming the already-logged name/rationale
  mismatch gap below is real and reproducible, not just theoretical.
- Group reveal showed the Frozen-cast roster with "you both like X" shared-interest
  highlighting; opened group chat and sent a message — delivered and rendered live.
- People's stay-badge/Say-hi flow worked against real seeded data
  (`scripts/seed-fake.ts`, now 20 Frozen-cast profiles).
- One anomaly, not reproduced on retry: a single test user's `profiles` row was briefly
  missing after what looked like a successful onboarding finish, on the very first complex
  multi-context script run against this brand-new project (whose own dashboard was showing
  occasional transient 500s at the time). Two clean re-tests (fresh onboarding, and
  re-login of an already-onboarded user) both completed correctly. Flagging as an
  unconfirmed, unreproduced anomaly rather than a code fix — if a real user ever reports
  "I finished setup but the app sent me back to onboarding," this is the first thing to
  check.

Local `.env.local` (gitignored) now points at this live project instead of the placeholder
values from earlier sessions.

### Update — 2026-07-28 Icebreaker reskin + Event & stay + People "Say hi"

Full visual reskin ("Icebreaker" — frost-navy + icy-cyan, Frozen-cast mock data in
`scripts/seed-fake.ts`) plus real product changes, per `Icebreaker Design Guide.dc.html`:

- **Shipped for real:** onboarding step 1 "Event & stay" (`event_id`/`stay_start`/
  `stay_end` on `profiles`, migration `0009`); onboarding step 4 "Contact & bio"
  (collects kakao/linkedin/bio during setup, not left for the Me screen); onboarding's
  flight panel now actually calls `submitFlight()` instead of writing to `localStorage`
  only; Join sheet shows `join_deadline` ("Tables revealed…"); login's "check your email"
  gets Resend (`supabase.auth.resend`) + "use a different email"; People shows a
  stay-relationship badge (`lib/stay.ts`, unit-tested) with filter chips, and a real,
  persisted "Say hi" request (`hi_requests` table, migration `0010`, `app/actions/hi.ts`)
  — deliberately **not** wired into `shares_channel()`, so full-contact RLS is unchanged.
  **`hi_requests` has no recipient-facing inbox UI yet** — the row is written for real
  (unlike the old Rides "Share" stub), but nothing surfaces an incoming request to the
  person who received it. Worth a follow-up.
- **`/mentor` removed.** It was already unreachable from any nav. `lib/mentorMatch.ts` +
  its tests are untouched — if mentor matching gets revisited, see
  `docs/mentor-match-logic.md`'s "What building it needs" section.
- **Logged, not built this pass** (data model is in place; enforcement isn't) — **all
  six of these were actually closed out on 2026-07-29, see "Matching pipeline
  correctness" and "Conference generalization" above; left here, annotated, as the
  original record of the gap rather than deleted outright:**
  - ~~`event_id` isn't read by `runMatching` or `rides.ts`~~ — ✅ fixed:
    `lib/scheduleFilter.ts`'s `isEligibleForSlot()` now hard-filters on it inside
    `matchOneSlot`.
  - ~~`JoinSheet` doesn't check a slot's date against the signer's stay window~~ —
    ✅ fixed: `joinSlot()` returns `schedule_conflict`, `JoinSheet` shows a warning
    and retries with `confirmed: true`.
  - ~~No two-stage matching pipeline exists~~ — ✅ fixed: the schedule filter runs
    first and hard-excludes anyone ineligible; interest scoring only ever sees the
    eligible subset.
  - ~~`matchSlot()` skips the LLM whenever headcount ≤ 6~~ — ✅ fixed: that shortcut
    is gone; round-robin is now genuinely reserved for failure.
  - ~~A failed `validateAssignment` re-packs the whole slot~~ — ✅ fixed:
    `repackInvalid()` keeps whatever tables were already valid.
  - ~~A round-robin table can still draw a flavorful name while its rationale stays
    generic~~ — ✅ fixed: only LLM-matched tables draw a themed name now.
  - ~~`EVENT_OFFSET`/`EVENT_AIRPORT` hardcoded for one event/timezone~~ — ✅ fixed:
    both are now `conferences` row fields (see "Conference generalization" above).
- Migrations `0009_event_stay.sql` and `0010_hi_requests.sql` need to be applied to the
  live Supabase project (same manual step as `0008`) before any of the above works —
  **this is still true**; see "Remaining Human TODOs" below for the current full
  migration list.

### Update — 2026-07-28 bug review pass
- **Security fix (apply promptly): migration `0008_profiles_contact_rls.sql`.** The
  `profiles` SELECT policy allowed any signed-in user — including anonymous guests — to
  read every column of every profile directly (kakao, linkedin, dietary, birthday), not
  just the public fields exposed through `directory_profiles`. The app's "contacts unlock
  only once you share a table" gate (`can_see_contact()`) was only ever enforced in
  `PeopleBrowser`'s UI, not in the database, so it was trivially bypassable with a direct
  Supabase client call. Fixed by scoping the base policy to the owner or anyone who
  already `shares_channel()` with them — every existing read (Me, GroupReveal, Chat
  roster) still works since those only ever query someone the caller already shares a
  group with. **Needs to be applied to the live Supabase project before the event.**
- **Fixed:** onboarding's Step 3 "Add flight info" field wrote to `localStorage` and was
  never read by anything else — a person's flight info typed there during onboarding was
  silently discarded despite the UI claiming "Used later to suggest airport rides."
  Removed; `/rides/add` (with Claude screenshot parsing) is the real, working flow and is
  already surfaced from Home's "Line these up" hub.
- **Fixed:** Rides' "Share" button claimed "*{name} gets your name and can message you*"
  — it's `useState` only, nothing is sent anywhere (no `ride_members`/message row is
  written). Copy corrected to not claim a connection was made.
- **Flagged, not fixed (needs a product/scope decision):** `/mentor` presents opting in as
  a working 1:1 matching feature ("we pair you... and make the intro"), but
  `assignMentees`/`suggestGroups` (`lib/mentorMatch.ts`) are only ever invoked from
  `/match-demo` against synthetic data — there is no admin action, table, or job that runs
  matching against real signed-up users. `docs/mentor-match-logic.md` already tracks this
  as "the model, not yet built," but the live page doesn't currently say so. Worth a call
  on whether to soft-launch the page as "coming soon" before Aug 5, or prioritize building
  the batch job (needs a `matches` table + a daily admin/cron trigger, per that doc's
  "What building it needs" section).

### Update — 2026-07-19 feature + polish run
- **Party size ("come as a group")** shipped: join-time "How many are you?" (1–4), matching
  packs tables by headcount and keeps parties intact, reveal shows "+N with them". Migration
  `0005` applied to cloud. Design spec: `docs/superpowers/specs/2026-07-19-party-size-design.md`.
- **UX gap audit** written: `docs/UX-GAP-AUDIT.md` (prioritized). Fixed on this pass: Kakao
  broken link, Home ride-CTA dead-end, group-reveal back affordance, People empty state.
- **Logo** embedded on login + home header (`public/logo.png`).
- **Design polish** (impeccable): danger/accent-weak/overlay tokens, `:focus-visible` ring,
  unified error reds, teaching Rides placeholder.
- **Repo cleanup**: removed `CLAUDE.md`/`AGENTS.md` (Next.js note folded into README),
  rewrote README with setup + user state-flow.
- **Rides (started)**: `lib/flights.ts` — `fetchArrivals()` uses AeroDataBox (RapidAPI,
  set `AERODATABOX_API_KEY`) or the bundled Aug-4 MCO example; `bucketIntoPools()` groups
  arrivals by revised time so delays re-pool correctly. The Rides tab now renders the
  example pools with delay badges + car-split estimate. Next: join/leave a pool (ride_pools
  tables already exist) + persist onboarding flight info.

## Status: BUILT + VERIFIED END-TO-END on cloud Supabase ✅

_Historical — this section and "Cloud DB state" below describe the **first**
verification pass, against a cloud project (`ctkjzenmwvqgrncxinvt`) that's since been
superseded. The live project as of 2026-07-29 is `kxvvnvzfdawsnftgjabl` (see that
date's "verified live end-to-end" update above) — kept for the QA-bugs-found record,
not as a current migration/DB reference. Use "Remaining Human TODOs" below for
current state._

All 12 core tasks built, and the full flow was driven and verified against the live
cloud database (project `ctkjzenmwvqgrncxinvt`, "sunny2.0"):

- ✅ **Magic-link login** — generated a real link, logged in, hit the callback.
- ✅ **Onboarding** (3 steps, avatar, interests incl. 국밥 crew, dinner opt-ins) → profile saved.
- ✅ **Slot join** → signup row created; **Home dashboard** shows joined-waiting then revealed.
- ✅ **Admin matching** — 21 signups → 4 valid groups (flex: no).
- ✅ **Group reveal** — member cards, interests, Korean names, rationale panel.
- ✅ **Realtime group chat** — verified LIVE delivery between two users (Sunghwan ↔ Ethan), Korean intact.
- ✅ **Directory contact-locking** — groupmate sees Kakao/LinkedIn; non-members gated by `can_see_contact`.

### 3 real bugs found & fixed during QA (all committed)
1. **Auth callback** only handled the PKCE `?code=` flow → magic links bounced to
   `/login?error=auth`. Added `token_hash` + `verifyOtp` path. (`0003`-era commit)
2. **Recursive RLS** on `group_members` (policy queried its own table → infinite
   recursion) silently nulled reveal/home/chat reads. Fixed with a SECURITY DEFINER
   `is_group_member()`. (migration `0003`)
3. **Realtime**: `messages` wasn't in the `supabase_realtime` publication, so chat
   never pushed live. Added it. (migration `0004`)

### Cloud DB state
- `.env.local` (gitignored) holds the live URL + legacy anon/service_role keys.
- Migrations applied: `0001` (schema+RLS), `0002` (directory), `0003` (RLS fix),
  `0004` (realtime), `0005` (party_size). **If you reset/recreate the DB, re-apply all
  five in order.**
- Seeded: 4 real slots (Wed/Thu/Fri dinners + Sat lunch) + 20 fake users on Day 2 Dinner.

## Remaining Human TODOs

_Rewritten 2026-07-29 — everything below is current as of the last update at the top
of this file. Items resolved since the last pass (migration `0008`, the original
Vercel deploy, rides/polish) have been removed rather than left stale; see the dated
Updates above for what actually closed them out._

1. **Apply migrations `0011`–`0015` to the live Supabase project**
   (`kxvvnvzfdawsnftgjabl`) — `0011_ride_join.sql`, `0012_conference.sql`,
   `0013_message_reads.sql`, `0014_notifications.sql`,
   `0015_group_starter_question.sql`. Same manual SQL-editor step as every prior
   migration. Until these are applied: ride "Share" isn't real, `/admin` can't
   register a conference, `/chat`'s unread badges stay at 0, no notifications get
   written anywhere, and reading/writing `groups.starter_question` will fail against
   the live DB's still-named `suggested_place` column.
2. **Register a conference at `/admin`** (sign in as `ADMIN_EMAIL`) — name, location,
   start/end dates, timezone, airport code. Until one is registered, every page shows
   the generic "Icebreaker" fallback instead of the real event name/dates, and
   onboarding's Step 1 has nothing to show.
3. **Set `CRON_SECRET`** in Vercel's env vars (and local `.env.local`) to match what
   Vercel Cron sends as a bearer token to `/api/cron/auto-match`. ⚠️ **Auto-matching
   is deployed but functionally inert** without both this *and* step 2's conference
   registered with `auto_matching_enabled` turned on — don't read "the cron route
   exists" as "auto-matching is live." Separately, Vercel Hobby only fires the cron
   tick once/day regardless of the admin-configured interval (see the deploy-break
   update above) — Pro is needed for a tighter tick.
4. **Confirm `ANTHROPIC_API_KEY` is set on the live Vercel project.** Without it,
   matching uses the round-robin fallback (groups are correct, but the rationale is
   generic instead of the warm AI blurb, and tables get plain "Table N" names instead
   of a themed one — see "Matching pipeline correctness" above). Status as of the
   last live check (07-29, pre-migration-0012 project) was: not set.
5. **Google OAuth** (optional) — enable in Supabase Auth providers; the login page's
   email+password and magic-link paths already work without it.

## Deploy to Vercel (checklist)

_Deployed as of 2026-07-29 — this repo is live on Vercel via the `fork` remote
(`J1w0n-H/ukc-social`), auto-deploying `main` (confirmed green after the cron-schedule
fix above). Kept below as the runbook for a fresh project/re-deploy, not a "not done
yet" TODO anymore — steps 1–4 don't need repeating for this project._

1. **Import the repo** into Vercel (framework auto-detects as Next.js).
2. **Set env vars** in Vercel → Project → Settings → Environment Variables (Production +
   Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `CRON_SECRET` (must match the bearer
   token Vercel Cron sends to `/api/cron/auto-match`), and optionally
   `ANTHROPIC_API_KEY` (AI matching rationale + flight-screenshot parsing; without it
   both fall back to deterministic/manual paths), `GEMINI_API_KEY`, and
   `AERODATABOX_API_KEY` (live airport arrivals on Rides — `lib/flights.ts` still
   reads this; **corrects an earlier, wrong claim in this doc that it was dead** —
   without it, Rides falls back to the bundled Aug-4 MCO example data). Values mirror
   `.env.local`. The service-role key is server-only — never expose it as
   `NEXT_PUBLIC_*`.
3. **Deploy**, note the assigned domain (e.g. `icebreaker.vercel.app`).
4. **Point Supabase auth at the domain:** Supabase → Auth → URL Configuration →
   Site URL `https://<domain>`, and add redirect `https://<domain>/auth/callback`
   (keep `http://localhost:3000/auth/callback` for local dev). Magic links bounce to
   `/login?error=auth` if this is missing.
5. **DB is live** (project `kxvvnvzfdawsnftgjabl`), but only `0001`→`0010` are
   confirmed applied — **`0011`→`0014` still need applying, see "Remaining Human
   TODOs" above.** Seeded with real slots + 20 Frozen-cast fake profiles. If you
   deploy against a fresh Supabase project instead, apply all fourteen migrations in
   order first, then re-seed.
6. **Smoke test on the domain:** magic-link login → onboarding (5 steps) → join a dinner
   (try a party of 2–3) → admin runs matching at `/<domain>/admin` → reveal → chat
   delivers live → People's Say hi.
7. **(Optional) Google OAuth:** enable in Supabase Auth providers; the magic-link path works
   without it.

## Dev helpers
- `scripts/seed-slots.ts`, `scripts/seed-fake.ts` — `npx -y tsx --env-file=.env.local scripts/<f>.ts`
- `scripts/dev-magiclink.mjs <email>` — prints a local login link for testing (no inbox needed).

## Known nits (not blockers)
- Next 16: rename `middleware.ts` → `proxy.ts` eventually.
- `/meals` shows an error card (not a redirect) if the DB is ever unreachable.
- Magic-link emails from real Supabase go to the real inbox; for scripted testing use `dev-magiclink.mjs`.
