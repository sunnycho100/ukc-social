# UKC Social: Scalability Plan

Scope: extending from the FIRE track to the full UKC 2026 conference.
Assumed scale: 500 registered baseline, 2,000 stretch, peak concurrency 10 to 20 percent
of registered users inside a few minutes (200 to 400 concurrent).
Reviewed against commit `d90d1b2`, Next.js 16.2.10, `@supabase/ssr` 0.12.3, Supabase project
`ctkjzenmwvqgrncxinvt` on the FREE tier.

---

## Bottom line

Supabase holds. Nothing in this app needs AWS at full-UKC scale. Postgres is not the
constraint: the entire dataset at 2,000 users is roughly 60 MB against a 500 MB free-tier
allowance, and the peak query load is about 40 queries per second, which a shared Nano
instance serves without breaking a sweat. What actually breaks is five specific things,
none of them the database engine: (1) the AI matching engine silently stops working above
roughly 150 signups in one slot because `max_tokens: 4096` truncates the tool call and the
code falls back to round-robin, and two sequential LLM calls exceed the Vercel function
timeout anyway; (2) the free tier caps realtime at 200 concurrent connections and a dinner
reveal at 2,000 users puts 200 to 400 people into group chat at once; (3) three pages fetch
unbounded row counts and count them in JavaScript, so `/people` ships roughly 860 KB per view
at 2,000 users and `/meals` scans every signup row in the database on every load; (4) there
is not a single explicit index in `supabase/migrations/`, and `group_members.user_id` is
unindexed while its RLS policy calls a non-inlinable SECURITY DEFINER function per row
scanned, which compounds; (5) Supabase auth rate limits are per-IP and the whole conference
sits behind one venue NAT, so signup and anonymous guest login will 429 on conference day
regardless of database capacity. All five are fixable in about one day of work plus a $25/mo
Supabase Pro upgrade. So the honest answer to the organizers is: **Supabase holds, but fix
these five things first, in that order, and move off the free tier before conference week.**

---

## Findings table

| # | Issue | File:line | Impact at 500 users | Impact at 2,000 users | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | LLM matcher truncates: `max_tokens: 4096` cannot emit 300 UUIDs, so `validateAssignment` fails twice and returns `roundRobinGroups` | `lib/matching.ts:88`, fallback at `:97`; caller `app/actions/admin.ts:90-101` | A popular slot with 300 signups already exceeds the output budget. Interest matching silently becomes random seating. Admin sees `strategy: "fallback"` | Guaranteed fallback on every large slot. The headline feature does not run at all | Chunk the roster into batches of 40 signups, call `matchSlot` per batch with `Promise.all`, raise `max_tokens` to 8192 per batch | M |
| 2 | Two sequential Sonnet calls in one server action; no `maxDuration` set anywhere in the repo | `lib/matching.ts:87-96`; no `maxDuration` in `app/actions/admin.ts` or `next.config.ts` | A 4,096-token emission takes 60 to 90 s. Vercel Hobby caps server actions at 10 s, Pro defaults to 15 s. Times out today at ~40 signups | Times out unconditionally | Add `export const maxDuration = 300`, go Vercel Pro, and parallelize per finding 1. If a slot ever exceeds 1,000 signups, move to a queued worker | S |
| 3 | Realtime concurrent connection cap: free tier is 200 peak | `components/Chat.tsx:172-191` (one websocket per open chat) | 50 to 100 concurrent chat viewers at a reveal. Under the cap, holds | 200 to 400 concurrent. Free tier refuses connections above 200. Chat stops live-updating with no visible error | Upgrade to Pro (500 concurrent). If sustained demand exceeds 500, switch `postgres_changes` to Realtime Broadcast | S |
| 4 | `/people` selects the entire directory with no limit, pagination, or virtualization, then passes all rows as props to a client component | `app/(tabs)/people/page.tsx:7-10` → `components/PeopleBrowser.tsx:104-113` | 500 rows, ~215 KB uncompressed, ~50 KB gzipped. Fine | 2,000 rows, ~860 KB uncompressed, ~200 KB gzipped, crossing the wire twice (Supabase to Vercel, Vercel to browser). 2,000 unvirtualized DOM rows means 2 to 4 s paint on a mid-range phone | Server-side search plus `.range()` pagination at 50 per page; drop `bio` from the list query and fetch it on sheet open | M |
| 5 | `/meals` selects every signup row in the database with no `slot_id` filter, then counts in JS | `app/(tabs)/meals/page.tsx:13-15` (`.select("slot_id, user_id, party_size, notes")`, no `.eq`), aggregation loop at `:20-25` | ~600 rows, ~72 KB per view. Tolerable | ~3,000 rows, ~360 KB per view, on the most-visited page. At 400 concurrent that is ~144 MB of egress in one burst | Replace with a `slot_counts` SQL view (or an RPC) doing `sum(party_size) group by slot_id`, plus one `.eq("user_id", me)` query for the caller's own signups | M |
| 6 | `/rides` selects all flights for the airport with no `direction` filter and no limit, then splits by direction in JS | `app/(tabs)/rides/page.tsx:31-37`, JS split at `:56-57` | ~800 rows, ~160 KB. Fine | ~4,000 rows, ~800 KB per view | Add `.eq("direction", dir)` driven by the tab, plus a time-window filter, plus `.limit(200)` | S |
| 7 | No index on `group_members.user_id`, and `gm_sel` calls `is_group_member()` (SECURITY DEFINER, not inlinable) once per row scanned | index absent across all of `supabase/migrations/`; policy at `0003_fix_group_members_rls.sql:16-17`; queries at `app/(tabs)/home/page.tsx:47-52` and `app/(tabs)/me/page.tsx:45-48` | ~1,000 rows scanned per home load, ~5 ms. Invisible | ~4,000 rows scanned, ~4,000 function calls plus index probes, ~15 to 25 ms per home load. At 400 concurrent home loads in 60 s that is ~8 CPU-seconds of pure RLS evaluation on a shared Nano core | `create index on group_members (user_id)` turns 4,000 scanned rows into 2 | S |
| 8 | No index on `messages.channel_id`; the chat history query filters on it and sorts by `created_at` | index absent; query at `components/Chat.tsx:152-157` | ~4,000 messages, seq scan ~3 ms | ~40,000 messages, seq scan plus in-memory sort, ~30 to 50 ms per chat open. Degrades linearly: at 200,000 rows it is 150 to 250 ms | `create index on messages (channel_id, created_at desc)` makes it an index scan with an early `LIMIT 100` stop | S |
| 9 | Home page issues 8 sequential Supabase round trips, plus 2 `auth.getUser()` network calls | `app/(tabs)/home/page.tsx:39, 47, 69, 79, 94, 109, 118, 128`; auth at `middleware.ts:27` and `lib/supabase/server.ts:31` | 10 sequential round trips at ~40 ms each, ~400 ms TTFB floor | Same round trips, each now slower under contention. p95 plausibly 1.5 to 2.5 s during a session-break burst | `Promise.all` the independent reads (queries at :79, :109 and :128 do not depend on each other), collapsing 8 waves to 3 | S |
| 10 | `middleware.ts:27` calls `auth.getUser()` on every non-static request, and every page then calls it again via `requireUser()` | `middleware.ts:27-34`, `lib/supabase/server.ts:27-34` | 2 auth server round trips per navigation, ~80 ms each | Doubles the auth request volume, ~800,000 auth calls over the conference | Replace `getUser()` in middleware with `getClaims()` (local JWT verification against the project's asymmetric signing key, zero network round trip). Keep `getUser()` only where a fresh server check is required | S |
| 11 | Auth rate limits are per source IP; the whole conference is behind one venue NAT | `app/(auth)/login/page.tsx:54` (`signInAnonymously`), `:71` (`signUp` with `emailRedirectTo`) | Onboarding 500 users from the venue WiFi hits the 30-per-hour-per-IP signup cap in the first two minutes. Guest mode fails the same way | Same wall, four times as many people queued behind it | Raise the auth rate limits in the Supabase dashboard, configure custom SMTP (Resend free tier covers 3,000/mo), and push onboarding to before arrival. Prefer the already-wired Google OAuth path at `:40`, which does not consume the email budget | S |
| 12 | Free-tier project auto-pauses after 7 days with no activity | Supabase free tier behavior | Real risk. If the app sits idle in the weeks before the conference, day-one users hit a paused project until someone manually restores it | Same | Pro never pauses. Upgrade before the conference regardless of load | S |
| 13 | Egress: free tier allows 5 GB/month | consequence of findings 4, 5, 6 | ~1 to 1.5 GB/month. Comfortable | ~4 to 7 GB/month, over the allowance. Pro's 250 GB is 40x headroom | Findings 4, 5, 6 cut this by roughly 4x on their own; Pro removes the ceiling | covered |
| 14 | `admin/page.tsx:16` reads `groups` through the user-scoped client, so `g_sel` filters it to groups the admin personally belongs to | `app/admin/page.tsx:16`; policy at `0001_core.sql` `g_sel` | Group counts per slot are wrong on the admin dashboard. Correctness, not throughput | Same | Use the service client (already built at `app/actions/admin.ts:33-39`) for admin reads | S |
| 15 | `p_sel` on `profiles` grants every authenticated user `select` on the full row, including `kakao` and `linkedin`. The `directory_profiles` view and `can_see_contact()` gate the UI but not the API | `0001_core.sql` `p_sel`; view at `0002_directory.sql:3-5` | Any logged-in user can read every attendee's contact details directly via PostgREST | Same, 2,000 people exposed | Restrict `p_sel` to `auth.uid() = id`, and let the directory view plus `can_see_contact()` be the only path to other people's data. Not a scaling issue, but it scales the blast radius | M |

---

## Ranked fix list

Ordered cheapest-highest-impact first. Items 1 through 5 are the ones that must ship before
the organizers are told yes.

### 1. Add the missing indexes (effort S, 5 minutes)

There is currently not one `create index` statement in `supabase/migrations/`. Everything
relies on primary keys and unique constraints. What that leaves covered and uncovered:

Already covered by existing constraints, do not add:
- `signups.slot_id` (leading column of `signups_slot_id_user_id_key`)
- `group_members.group_id` (leading column of the PK)
- `ride_members.pool_id` (leading column of the PK)
- `flights.user_id` (leading column of `flights_user_id_direction_key`)
- `profiles.id`, `slots.id`, `groups.id`, `messages.id` (primary keys)

Missing, and used as a filter or join column in app code:

```sql
-- supabase/migrations/0008_indexes.sql

-- group_members.user_id: trailing column of the PK, so unindexed on its own.
-- Read by app/(tabs)/home/page.tsx:52 and app/(tabs)/me/page.tsx:48, and joined
-- twice by shares_channel() in 0001_core.sql. Highest leverage index here:
-- gm_sel calls is_group_member() per row scanned, and SECURITY DEFINER functions
-- are not inlined by the planner, so this index removes ~4,000 function calls per
-- home-page load at 2,000 users.
create index gm_user_idx on group_members (user_id);

-- messages.channel_id: unindexed. Filtered at components/Chat.tsx:155 and by the
-- m_sel / m_ins RLS policies. The composite with created_at desc lets the
-- ORDER BY created_at DESC LIMIT 100 stop after 100 index entries instead of
-- scanning and sorting the whole table.
create index msg_channel_time_idx on messages (channel_id, created_at desc);

-- signups.user_id: trailing column of the unique constraint, so unindexed alone.
-- Filtered at app/(tabs)/home/page.tsx:82, app/(tabs)/me/page.tsx:39,
-- app/actions/profile.ts:68, app/actions/signups.ts:44.
create index signups_user_idx on signups (user_id);

-- groups.slot_id: unindexed. Filtered by the idempotent wipe at
-- app/actions/admin.ts:111 and by the admin dashboard read.
create index groups_slot_idx on groups (slot_id);

-- flights: the rides board filters by airport and orders by scheduled_at.
create index flights_board_idx on flights (airport, direction, scheduled_at);

-- ride_members.user_id: trailing column of the PK. Joined by shares_channel().
-- Cheap insurance; these tables are described as never-wired in 0006, so this is
-- only worth adding if ride_pools/ride_members stay in the schema.
create index rm_user_idx on ride_members (user_id);
```

Concrete degradation without them, so the numbers are on record:
- `group_members.user_id`: 4,000 rows at 2,000 users, roughly 15 to 25 ms per home-page load
  because of the per-row SECURITY DEFINER call. At 40,000 rows it is 150 to 250 ms.
- `messages.channel_id`: 4,000 messages is a 3 ms seq scan; 40,000 is 30 to 50 ms;
  200,000 is 150 to 250 ms plus a sort. The conference will land in the 20,000 to 60,000 range.
- `signups.user_id` and `groups.slot_id`: both under 10 ms at any plausible UKC row count.
  Add them because they cost nothing, not because they are urgent.

**Which table's reads degrade first: `group_members`.** It is the only place where an
unindexed filter column and a per-row non-inlinable RLS function stack on top of each other,
and it sits on the home page, which is the single most-loaded route.

### 2. Fix the matching engine (effort M, half a day)

This is the highest-stakes finding because it degrades silently and it is the feature the
app is named for.

`lib/matching.ts:88` sets `max_tokens: 4096` for a single call covering the whole slot.
Output cost per attendee is roughly 12 tokens for the UUID plus about 8 tokens amortized for
the group name, rationale, and cuisine suggestion, so about 20 tokens per attendee. The
4,096-token ceiling therefore breaks somewhere around 150 to 200 attendees. Past that the
tool call is truncated, `validateAssignment` at `:94` reports missing ids, the loop retries
once and truncates again, and `:97` returns `roundRobinGroups`. The 400-signup dinner slot
that the organizers care most about is the one that gets random seating.

The runtime problem is separate and worse. A single Sonnet emission of 4,096 tokens takes
60 to 90 seconds. Two attempts is 120 to 180 seconds. There is no `maxDuration` export
anywhere in the repo, so this runs at the platform default: 10 seconds on Vercel Hobby,
15 seconds on Pro. It times out today at roughly 40 signups.

Fix, in order:
1. `export const maxDuration = 300` in `app/actions/admin.ts` and move to Vercel Pro.
2. Pre-partition the slot into batches of 40 signups (bucket by primary interest so the LLM
   still has something to match on), then `Promise.all` a `matchSlot` call per batch. Ten
   batches of 40 run concurrently in the time one batch takes, roughly 15 seconds total, and
   each batch's output fits well inside 4,096 tokens.
3. Keep the `roundRobinGroups` fallback. It is correct behavior, it just must not be the
   default path.

### 3. Bound the three unbounded page queries (effort M, half a day)

`app/(tabs)/meals/page.tsx:13`

```
.from("signups").select("slot_id, user_id, party_size, notes")
```

No `.eq`, no `.limit`. This fetches every signup row in the database and aggregates in
JavaScript at `:20-25`. Replace with a view:

```sql
create view slot_counts with (security_invoker = true) as
  select slot_id, sum(party_size)::int as seats from signups group by slot_id;
```

plus a separate `.eq("user_id", user.id)` query for the caller's own signups. That turns a
3,000-row transfer into roughly 10 rows.

`app/(tabs)/people/page.tsx:7-10` selects the whole directory including `bio`, orders by
name, and hands every row to a client component. Add `.range()` pagination at 50 per page,
push the search filter server-side with `.ilike`, and drop `bio` from the list query since
`PeopleBrowser` only renders it inside the opened sheet.

`app/(tabs)/rides/page.tsx:31-37` fetches both directions and splits them in JS at `:56-57`.
Add `.eq("direction", ...)`, a `scheduled_at` time window, and `.limit(200)`.

### 4. Move off the free tier (effort S, 5 minutes, $25/mo)

Two free-tier limits are hard walls at this scale and one is a conference-day landmine:
- Realtime concurrent connections: 200 free, 500 on Pro. A dinner reveal at 2,000 users puts
  200 to 400 people into chat at once. Above the cap the websocket is refused and
  `components/Chat.tsx` shows no error, it just stops updating live.
- Egress: 5 GB/month free, 250 GB on Pro. At 2,000 users the current queries project to
  4 to 7 GB/month.
- Auto-pause after 7 days of inactivity. If the app is quiet in the weeks before the
  conference, day one starts with a paused project.

### 5. Fix the auth rate limits before onboarding starts (effort S, 1 hour)

`app/(auth)/login/page.tsx:71` calls `signUp` with `emailRedirectTo`, meaning a confirmation
email per user. Supabase's built-in SMTP is capped at a handful of emails per hour and is
explicitly not intended for production. Separately, signup and `signInAnonymously`
(`:54`) are rate-limited per source IP at 30 per hour by default. A conference venue NATs
every attendee behind one address, so both guest mode and email signup will start returning
429 within minutes of the first session break.

Actions: configure custom SMTP (Resend's free tier covers 3,000/month), raise the auth rate
limits in the dashboard, direct onboarding to happen before arrival, and promote the Google
OAuth button at `:40` as the primary path since it does not consume the email budget.

### 6. Parallelize the home page and stop double-checking auth (effort S, 2 hours)

`app/(tabs)/home/page.tsx` awaits 8 Supabase calls one after another (lines 39, 47, 69, 79,
94, 109, 118, 128), on top of two `auth.getUser()` network round trips (`middleware.ts:27`
and `lib/supabase/server.ts:31`). That is 10 sequential network hops before the page renders.
The queries at :79, :109, and :128 are independent of each other and of :39, so `Promise.all`
collapses 8 waves into 3. Replacing the middleware `getUser()` with `getClaims()` verifies
the JWT locally against the project's asymmetric signing key and removes one hop entirely.

### 7. Clean up the two correctness items (effort S/M)

`app/admin/page.tsx:16` reads `groups` through the RLS-bound user client, so `g_sel` filters
it to groups the admin is personally a member of and the dashboard undercounts. Use the
service client already defined at `app/actions/admin.ts:33-39`.

`p_sel` on `profiles` (`0001_core.sql`) allows any authenticated user to select the full row
including `kakao` and `linkedin`. `directory_profiles` and `can_see_contact()` gate the UI,
not the API. Tighten `p_sel` to `auth.uid() = id`.

---

## RLS cost audit

Per-row subquery policies, in order of how much they cost:

| Policy | Table | Shape | Cost |
|---|---|---|---|
| `gm_sel` | `group_members` | `is_group_member(group_id)`, a SECURITY DEFINER SQL function | Worst. SECURITY DEFINER functions are not inlined by the planner, so this is a real function call plus an index probe per row scanned. Combined with the missing `user_id` index it runs ~4,000 times per home-page load at 2,000 users |
| `g_sel` | `groups` | `exists (select 1 from group_members m where m.group_id = id and m.user_id = auth.uid())` | Correlated subquery per group row scanned. Index-backed by the `group_members` PK, so roughly 2 to 5 microseconds each. At 400 groups it is ~2 ms, at 2,000 groups ~10 ms |
| `m_sel` / `m_ins` | `messages` | `exists (...)` against `group_members` or `ride_members` | Per row scanned. Index-backed on the group side. The exposure is that `messages.channel_id` is unindexed, so a chat open scans the whole table and evaluates this per row |
| `can_see_contact` → `shares_channel` | `profiles` (via RPC) | Two self-joins of `group_members` and `ride_members` on the non-leading `user_id` column | Seq-scans both tables per call. Called once per profile sheet open in `PeopleBrowser.tsx:145`. The `gm_user_idx` and `rm_user_idx` indexes fix this |
| `p_sel`, `s_sel`, `su_sel`, `rp_sel`, `rm_sel`, `f_sel` | various | `auth.role() = 'authenticated'` | Constant, no subquery. `auth.role()` is STABLE so it evaluates once per query. Cheap. Wrapping as `(select auth.role()) = 'authenticated'` guarantees a single InitPlan evaluation, a free micro-win worth doing when the indexes migration lands |

**First to degrade: `group_members`, then `messages`.** Both for the same reason, an
unindexed filter column forcing a full scan while a per-row RLS predicate rides along.

---

## Connection pooling

The app opens zero direct Postgres connections. Verified: `grep` for `DATABASE_URL`,
`postgres://`, and the `pg` package across `app/`, `lib/`, `components/`, `scripts/`,
`middleware.ts`, and `next.config.ts` returns nothing, and `package.json` lists no Postgres
driver. Every database access goes through one of three supabase-js clients:

- `lib/supabase/server.ts:5-25`, `createServerClient` from `@supabase/ssr`, cookie-bound, used
  by every server component and server action.
- `lib/supabase/client.ts:3-8`, `createBrowserClient`, used by `Chat.tsx:101` and
  `PeopleBrowser.tsx:145`.
- `app/actions/admin.ts:33-39`, a service-role `createClient` for the matching job.

All three speak PostgREST over HTTPS. PostgREST holds the connection pool server-side inside
Supabase, so the classic serverless failure mode of thousands of Lambda instances each
opening a Postgres connection does not apply here. Nothing needs Supavisor, PgBouncer, or a
`?pgbouncer=true` connection string.

The practical consequence: the ceiling is PostgREST's own pool size, which Supabase sizes to
the compute instance (roughly 10 to 20 connections on Nano and Micro). At the projected peak
of about 40 queries per second with sub-50 ms queries, that pool is nowhere near saturated.
This is not the constraint, and any conversation about "we need AWS RDS for connection
limits" is answering a question this stack does not ask.

One thing to watch on Nano and Micro compute: both have a burstable disk IO budget that
depletes under sustained load, after which throughput drops sharply. That is a compute-tier
question, not a connection question, and it is why the load test below includes disk IO in
the watch list.

---

## Realtime path assessment

`components/Chat.tsx:172-191` subscribes with `postgres_changes` on `INSERT` to
`public.messages`, filtered `channel_id=eq.${channelId}`.

- **Is the filter server-side?** Yes. The `filter` string is part of the `postgres_changes`
  subscription config, so the Realtime server evaluates it and only clients subscribed to
  that `channel_id` receive the row. RLS `m_sel` then runs per matching subscriber. A message
  in a 5-person table costs 5 RLS evaluations, not 400. This is correctly built.
- **Is the initial load bounded?** Yes. `Chat.tsx:152-157` is
  `.order("created_at", { ascending: false }).limit(100)`, reversed client-side at `:159`.
  Bounded payload, roughly 20 KB. The only problem is that `channel_id` has no index, so
  reaching those 100 rows requires a full table scan plus a sort.
- **How many concurrent connections at peak?** supabase-js multiplexes all channels over one
  websocket per browser client, so it is one connection per open chat tab, not per channel.
  At 2,000 registered users with 10 to 20 percent concurrency that is 200 to 400 open
  sockets during a dinner reveal. Free tier caps at 200 peak, Pro at 500.
- **Message volume.** Roughly 400 groups at 2,000 users, say 40 messages per group over the
  conference, fanned out to 5 members each: about 80,000 delivered messages. Free tier
  allows 2 million per month, Pro 5 million. Volume is a non-issue; concurrency is the issue.
- **Verdict.** The realtime design is sound and does not need to change. It needs the Pro
  connection ceiling and the `messages` index. `postgres_changes` becomes the wrong primitive
  somewhere north of 500 sustained concurrent subscribers, at which point the migration is to
  Realtime Broadcast, which is a same-tier change and still not an AWS conversation.

---

## Supabase tier limits, and which one binds first

| Limit | Free | Pro (~$25/mo) | This app at 2,000 users | Binds? |
|---|---|---|---|---|
| Database size | 500 MB | 8 GB included, then $0.125/GB | ~60 MB (2,000 profiles ~2 MB, 5,000 signups ~1 MB, 4,000 group_members ~0.4 MB, 50,000 messages ~10 MB, 4,000 flights ~1 MB, plus indexes and WAL) | No, 8x headroom on free |
| Egress | 5 GB/mo | 250 GB included, then $0.09/GB | 4 to 7 GB/mo at current query shapes; ~1.5 GB after fixes 3 and 5 | **Yes, on free** |
| Realtime concurrent connections | 200 peak | 500 peak | 200 to 400 at a dinner reveal | **Yes, on free. First hard wall** |
| Realtime messages | 2M/mo | 5M/mo | ~80,000 | No |
| Monthly active users | 50,000 | 100,000 included | 2,000 | No |
| API requests | No hard cap | No hard cap | ~40 req/s peak | No |
| Auth: signup and anonymous sign-in | 30/hour per IP (configurable) | same default | Entire conference behind one NAT IP | **Yes, at any tier until raised. First wall in wall-clock time** |
| Auth: built-in SMTP | A few emails per hour, test use only | same, custom SMTP required for production | 500 to 2,000 confirmation emails | **Yes, at any tier until custom SMTP is configured** |
| Project auto-pause | After 7 days inactive | Never | Real risk in the quiet weeks before the conference | **Yes, on free** |
| Compute | Nano, shared, burstable IO | Micro included via $10 credit, scalable | ~40 qps peak | No |
| Backups | None | Daily, 7-day PITR available as an add-on | Losing the seating assignment mid-conference is unrecoverable on free | **Yes, operationally** |

**Which limit hits first.** In wall-clock order during conference week: the auth per-IP rate
limit and the SMTP cap, during onboarding, before the database sees any real load at all.
Then, at the first dinner reveal, the 200-connection realtime cap. Then, over the course of
the week, the 5 GB egress allowance. Database size, MAU, API request volume, and compute are
never the constraint at UKC scale, which is the part worth telling the organizers: the
answer "the backend runs on Postgres via Supabase, so it holds" is correct about Postgres
and incomplete about everything wrapped around it.

**Free-tier auto-pause is the single most embarrassing failure mode.** A project with no
requests for 7 consecutive days is paused, and the first attendee to open the app on day one
gets a connection error until someone logs into the dashboard and restores it, which takes
several minutes. Upgrading to Pro removes this outright and is worth the $25 for that reason
alone.

---

## Load test plan

### Environment

Run against a **separate Supabase project seeded to conference scale**, not production, and
against a Vercel preview deployment on the same plan tier intended for the conference. Test
on the tier you will run on: a Nano result tells you nothing about a Micro instance.

### What to seed

Extend `scripts/seed-fake.ts` (currently 20 users) to a `--count` argument:

| Table | Rows | Notes |
|---|---|---|
| `auth.users` + `profiles` | 2,000 | Realistic `bio` (~150 chars), 3 to 5 `interests`, `photo_url` populated so the directory payload is honest |
| `slots` | 10 | 8 meal, 2 other |
| `signups` | 3,000 | Deliberately skewed: one hot slot holds 400 signups, the rest spread thin. The hot slot is the matching-engine test case |
| `groups` | 500 | |
| `group_members` | 2,500 | |
| `messages` | 40,000 | 80 per channel across 500 channels, timestamps spread over 3 days |
| `flights` | 2,000 | Both directions, clustered into arrival windows |

Run the same suite twice: once at 500-user seed, once at 2,000, so the degradation slope is
measured rather than extrapolated.

### Tool: k6

Chosen over autocannon. autocannon hammers a single URL with no session state, and every
failure mode here is a stateful multi-endpoint journey: authenticate, carry the Supabase auth
cookie, hit home, then meals, then a group page, then hold a websocket. k6 gives ramp
profiles via `stages`, a per-VU cookie jar, per-endpoint `thresholds` that fail the run
automatically (so PASS/FAIL is machine-checked, not eyeballed), and websocket support via
`k6/ws` for the realtime leg. autocannon cannot express "400 VUs arrive over 90 seconds, each
completing a 5-request journey while holding a subscription."

### Scenarios

**A. Session break.** Ramp 0 to 400 VUs over 90 s, hold 5 min, ramp down over 30 s. Each VU
loops: `GET /home` → `GET /meals` → `GET /people` → `GET /groups/{id}` with 3 to 8 s of think
time. This is the read-path stress test.

**B. Dinner reveal.** 300 VUs arriving inside 60 s, each doing `GET /home` →
`GET /groups/{id}` → `GET /groups/{id}/chat` → open a websocket and hold it → send 2 to 3
messages. This is the combined read, write, and realtime test, and it is the scenario that
actually happens.

**C. Signup rush.** 200 VUs POSTing the `joinSlot` server action against the same hot slot
inside 30 s. Tests the `unique (slot_id, user_id)` upsert path under contention.

**D. Matching job.** Single invocation of `runMatching` on the 400-signup hot slot. Not a
load test, a timeout and correctness test.

**E. Realtime soak.** 500 concurrent websocket subscribers across 100 channels, held for
10 minutes, with a message published to each channel every 30 s. Confirms the connection
ceiling and that RLS fanout does not stall.

### Endpoints to hammer

1. `GET /home` (8 sequential queries plus 2 auth calls, the worst latency path)
2. `GET /people` (the worst payload path)
3. `GET /meals` (the unbounded signups scan)
4. `GET /groups/{id}` and `GET /groups/{id}/chat` (the RLS-heavy path)
5. `POST` server action `sendMessage` (write plus realtime fanout)
6. `POST` server action `joinSlot` (write plus unique-constraint contention)
7. `wss://ctkjzenmwvqgrncxinvt.supabase.co/realtime/v1/websocket` (connection ceiling)

### Metrics to watch

Client side, from k6: `http_req_duration` p50/p95/p99 tagged per endpoint,
`http_req_failed` rate, `checks` pass rate, `ws_connecting` duration, and websocket
disconnect count.

Server side, from the Supabase dashboard and `pg_stat_statements`: database CPU percent,
memory, **disk IO budget remaining** (Nano and Micro burst and then throttle, and a run that
looks fine for four minutes and collapses in the fifth is an IO budget exhaustion, not a
query problem), active connection count from `pg_stat_activity`, slowest queries by total
time, and realtime concurrent connection count.

From Vercel: function duration p95, function concurrency, and any timeout or 504 count.

### PASS/FAIL thresholds

Encode these directly as k6 `thresholds` so the run exits non-zero on failure.

| Metric | PASS | Rationale |
|---|---|---|
| `GET /home` p95 | < 800 ms | Most-loaded route. Above 800 ms during a session break the app feels broken |
| `GET /home` p99 | < 1,500 ms | |
| `GET /people` p95 | < 1,200 ms | Payload-bound; a looser bar is honest |
| `GET /meals` p95 | < 600 ms | Should be trivial once the count moves into SQL |
| `GET /groups/{id}/chat` p95 | < 700 ms | Gates the reveal experience |
| `sendMessage` action p95 | < 400 ms | |
| Message insert to visible in a subscriber's socket | < 2,000 ms | The felt latency of group chat |
| `http_req_failed` overall | < 0.5 % | |
| 5xx on any write path (`joinSlot`, `sendMessage`) | **exactly 0** | One 500 during dinner signup is a lost seat and a support conversation |
| Database CPU, sustained at 400 VUs | < 70 % | Leaves headroom for the load nobody modeled |
| Disk IO budget after a 10-minute run | > 50 % remaining | If it depletes, the compute tier is undersized regardless of p95 |
| Scenario E: 500 concurrent websockets held 10 min | 0 unexpected disconnects | Directly tests the tier ceiling |
| Scenario D: `runMatching` on the 400-signup slot | Completes in < 60 s **and returns `strategy: "interest"`** | The most important single assertion in this plan. A `"fallback"` result is a PASS on latency and a FAIL on product |

Scenario D's second condition is the one to run first, before any other work. It is a
one-line check and it will currently fail.

---

## When would we actually need AWS

Concrete triggers, so the answer to the organizers is a threshold rather than a maybe. None
of these are reached by UKC 2026 at 2,000 attendees.

1. **Sustained realtime concurrency above 500.** Supabase Pro caps at 500 peak connections.
   Before that becomes an AWS question, the fix is switching `Chat.tsx` from
   `postgres_changes` to Realtime Broadcast, which scales roughly an order of magnitude
   further on the same tier. The genuine trigger is "Broadcast is also saturated," which
   means several thousand simultaneous chat participants. UKC does not have that many people
   in the building.

2. **Matching workloads longer than 300 seconds.** This is the one real candidate today.
   If a single slot ever needs a multi-minute LLM pipeline over 1,000-plus signups, it does
   not belong in a Vercel function. But the answer is a queued worker, not a stack migration:
   Vercel Workflow, a Supabase Edge Function on a cron, Inngest, or a small Lambda plus SQS.
   Moving one background job to AWS is not moving to AWS.

3. **Beyond roughly 10,000 registered users with sustained write throughput.** At that point
   the conversation is about Supabase compute tiers (Small, Medium, Large), read replicas,
   and connection pooling via Supavisor. All of those are still Supabase products. Supabase
   already runs on AWS. The trigger for self-managed RDS is needing something Supabase does
   not expose at any tier: custom extensions Supabase does not ship, cross-region
   active-active, or a Postgres major version they do not offer.

4. **Compliance or data residency requirements Supabase's plans do not satisfy.** If UKC ever
   requires a specific region, BAA, or audit posture beyond what Supabase Team or Enterprise
   provides. This is a contractual trigger, not a technical one.

5. **Multi-tenancy across many conferences with isolated data per organizer.** Not a load
   problem, an architecture problem, and it would be solved with schemas or a `tenant_id`
   column long before infrastructure changed.

The honest summary for the organizers: the database is the least of the concerns. If this
app ever outgrows Supabase, it will be because of realtime connection concurrency or a
long-running background job, and both have cheaper answers than a migration.

---

## Cost estimate

**Today, free tier: $0.** Fails at UKC scale on realtime connections, egress, auth email
limits, and carries the 7-day auto-pause risk and no backups.

**Recommended for the conference:**

| Item | Cost | What it buys |
|---|---|---|
| Supabase Pro | $25/mo | 8 GB database, 250 GB egress, 500 realtime connections, 100,000 MAU, no auto-pause, daily backups, $10 compute credit covering a Micro instance |
| Supabase compute bump to Small, conference days only | ~$15/mo prorated, about $1/day | Optional. Buy it for the 2 peak days if the load test shows CPU above 70 percent on Micro |
| Vercel Pro | $20/mo per seat | Raises the function timeout from 10 s to 300 s (800 s with Fluid), which the matching job requires, plus 1 TB bandwidth |
| Anthropic API for matching | under $10 total | 2,000 attendees across ~10 slots, chunked into batches of 40. Roughly 500,000 input and 200,000 output tokens for the entire conference |
| Resend (custom SMTP) | $0 | Free tier covers 3,000 emails/month, enough for 2,000 confirmations |

**Total for the conference month: about $45 to $60**, and both subscriptions can be
downgraded back to free the week after. Projected usage against Pro allowances at 2,000
users: roughly 60 MB of 8 GB database, 5 GB of 250 GB egress, 400 of 500 realtime
connections, 2,000 of 100,000 MAU. The only Pro limit anywhere near its ceiling is realtime
concurrency, and that is the number to watch during scenario E of the load test.

Overage math if the estimates are wrong: Supabase egress is $0.09/GB beyond 250 GB, so being
wrong by a factor of 10 on egress costs nothing. Being wrong on realtime concurrency is the
expensive mistake, because the next tier up is Team at $599/mo. That is the argument for
implementing the Broadcast migration path before conference week rather than discovering the
need during it.
