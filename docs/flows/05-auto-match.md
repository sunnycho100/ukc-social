# 05. Auto-match: the scheduled matching run

Index: [README.md](README.md) · Test-id prefix: `CRON`

Matching does not depend on an admin remembering to press a button. A Vercel Cron
job hits one route on a fixed tick; a pure gate function decides whether that tick
should actually do anything.

**Files**

| File | Role |
|---|---|
| `vercel.json` | the cron schedule |
| `app/api/cron/auto-match/route.ts` | auth, gate, run, stamp |
| `lib/autoMatch.ts` | `shouldAutoMatch`, the pure gate |
| `app/actions/admin.ts` | `runAllSlotsMatching`, which loops `matchOneSlot` |
| `components/AdminConferenceForm.tsx` | where an admin sets the toggle and interval |

---

## Scenario

An admin registers the conference and ticks "auto-matching enabled" with an
interval. From 7 days before the conference starts until it ends, every slot is
re-matched roughly that often, without anyone touching `/admin`.

## Sequence

```
Vercel Cron  ──GET /api/cron/auto-match, Authorization: Bearer $CRON_SECRET
                 │
                 ├─ wrong or missing secret ──────────► 401 {ok:false,error:"unauthorized"}
                 │
                 ├─ getConference(serviceClient)
                 ├─ shouldAutoMatch(conference, now) ── false ──► 200 {ok:true, ran:false}
                 │                                    true
                 ├─ runAllSlotsMatching(conference)
                 │     └─ for each slot (sequential): matchOneSlot(...)
                 │
                 ├─ update conferences.last_auto_match_at = now
                 │     └─ on error ──────────────────► 500 {ok:false,error}
                 │
                 └─ 200 {ok, ran:true, ranAt, results:[{slotId, ok, groups, flex, excluded}]}
```

---

## Algorithm: `shouldAutoMatch(conference, now)`

Pure, no I/O, kept out of the route specifically so every branch is unit-testable
without a live Supabase project. All four conditions must hold:

| # | Condition | Constant |
|---|---|---|
| 1 | a conference row exists | |
| 2 | `conference.auto_matching_enabled` | |
| 3 | `now` is within `[starts_at - 7 days, ends_at]` | `AUTO_MATCH_LEAD_DAYS = 7` |
| 4 | `now - last_auto_match_at >= matching_interval_minutes` | null `last_auto_match_at` passes |

Window boundaries are inclusive-ish in practice: the check is `nowMs < windowOpensAt`
and `nowMs > endsAtMs`, so exactly-at-boundary passes.

## `runAllSlotsMatching`

Reads every row from `slots` (no `kind` filter, so a non-meal slot would be matched
too) and runs `matchOneSlot` on each **sequentially**, collecting one result per
slot. Returns `ok: true` only when every slot succeeded.

Sequential rather than parallel matters: each slot is an Anthropic call plus several
writes, and running them concurrently would multiply the rate-limit surface.

`last_auto_match_at` is stamped **after** the loop, with the `now` captured before
it. A long run therefore does not push the next window out by its own duration.

---

## Tables and RLS touched

Everything runs through `serviceClient()`.

| Table | Operation |
|---|---|
| `conferences` | select, then update `last_auto_match_at` |
| `slots` | select all |
| `signups`, `groups`, `group_members`, `notifications` | see [04-matching.md](04-matching.md) |

---

## Known gap: the schedule and the interval disagree

`vercel.json` is:

```json
{ "crons": [{ "path": "/api/cron/auto-match", "schedule": "0 0 * * *" }] }
```

Once a day at midnight UTC. But `matching_interval_minutes` defaults to 360 and
accepts any positive integer, and the route's own comment says the tick "just needs
to fire at least as often as the shortest interval an admin might configure".

As shipped, auto-matching runs **at most once per day** regardless of what the admin
configures. Setting the interval to 60 minutes changes nothing. This is documented,
not fixed.

---

## Edge cases

| id | Case | Expected | Verified |
|---|---|---|---|
| `CRON-E01` | No `Authorization` header | 401, nothing read or written | code |
| `CRON-E02` | Wrong bearer token | 401 | code |
| `CRON-E03` | `CRON_SECRET` unset in the environment | The comparison becomes `Bearer undefined`, so a request literally sending that string would pass. Treat an unset secret as an open endpoint | code |
| `CRON-E04` | No conference registered | `shouldAutoMatch` returns false, 200 `{ok:true, ran:false}` | unit |
| `CRON-E05` | `auto_matching_enabled` is false | Same, `ran:false` | unit |
| `CRON-E06` | Now is more than 7 days before `starts_at` | `ran:false` | unit |
| `CRON-E07` | Now is exactly 7 days before `starts_at` | Runs. The check is strict `<` | unit |
| `CRON-E08` | Now is after `ends_at` | `ran:false` | unit |
| `CRON-E09` | `last_auto_match_at` is null (never run) | The interval check is skipped entirely, so the first eligible tick runs | unit |
| `CRON-E10` | Interval has not elapsed | `ran:false`, and `last_auto_match_at` is **not** re-stamped | unit |
| `CRON-E11` | Interval elapsed by exactly the configured minutes | Runs. The check is strict `<` | unit |
| `CRON-E12` | One slot fails during the loop | The loop continues to the remaining slots. The response `ok` is false but `ran` is true and `last_auto_match_at` is still stamped | code |
| `CRON-E13` | The `last_auto_match_at` update fails | 500 is returned **after** matching already committed, so the next tick will re-run every slot | code |
| `CRON-E14` | A non-meal slot exists | It is matched too. `runAllSlotsMatching` does not filter on `kind` | code |
| `CRON-E15` | Two ticks overlap | Nothing prevents concurrent runs. The second would re-delete and re-insert groups mid-flight. Not currently guarded | code |
| `CRON-E16` | Auto-match re-runs a slot that already has tables | Same behavior as a manual re-run: tables are rebuilt and everyone gets another `table_revealed` notification. See `MATCH-E21` | code |
| `CRON-E17` | `runAllSlotsMatching` invoked directly as a server action | It performs no auth check of its own. Only the route checks the secret | code |
