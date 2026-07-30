# Icebreaker

A conference companion for **UKC 2026** (Aug 5–8, ChampionsGate FL). Attendees make a
quick profile — including which event they're at and how long they're staying — join a
dinner slot, and get matched into small tables by shared interests, solo or as a pre-formed
group. They can browse who else is around (with an "arriving early / staying late / same
dates as you" badge and a light "Say hi") and post their flight to find someone to split an
airport ride with. Contacts unlock only for people you actually share a meal table with.

**Pillars:** profiles/directory (with stay-window "Say hi") · AI meal matching · airport
ride coordination. *(Mentor 1:1 matching is descoped for now — see `docs/HANDOFF.md` —
the algorithm still lives in `lib/mentorMatch.ts` but isn't wired to a route.)*
**Design:** "Icebreaker" — a Frozen-inspired frost-navy ground (`#0A121C`), a single
icy-cyan accent (`#4FD1E8`, gradient on filled primary buttons only) used only on
actions/state, de-boxed editorial layout (hairline dividers instead of cards, underline
inputs), Inter display/body + Noto Sans KR fallback. Korean-safe throughout. Dev/demo data
(`scripts/seed-fake.ts`) uses Frozen-universe names as placeholder profiles.

> **Heads up on Next.js:** this repo pins a Next.js version with breaking changes from what
> you may remember — APIs, conventions, and file structure can differ from older docs. Read
> the relevant guide in `node_modules/next/dist/docs/` before writing framework code, and
> heed deprecation notices.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind v4) — route groups `(tabs)` and `(auth)`.
- **Supabase** — Postgres, Auth (magic-link), Realtime, Storage (avatars), Row Level Security.
- **Anthropic** `claude-sonnet-5` for meal matching (with a deterministic round-robin fallback)
  and for reading flight-ticket screenshots on Rides. Group *names* come from a deterministic
  bank (`lib/groupName.ts`, `data/group-names.json`), not the LLM — see
  `docs/group-naming-logic.md`.
- **vitest** for unit tests.

## Setup

1. `npm install`
2. Copy `.env.example` → `.env.local` and fill in (see below). `.env.local` is gitignored —
   never commit it.
3. Apply the migrations to your Supabase project in order (see [Database](#database)).
4. `./start.sh` (boots the dev server, reuses one if already up, opens Chrome), or `npm run dev`.
5. Open http://localhost:3000.

### Environment variables (`.env.local`)

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon (public) key — client + server reads under RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — admin matching only, server-side |
| `ANTHROPIC_API_KEY` | Meal matching. Without it, matching uses the round-robin fallback |
| `ADMIN_EMAIL` | The one email allowed to run matching at `/admin` |
| `GEMINI_API_KEY` | Optional. Bespoke Claude/Gemini group names. Without it, the deterministic bank in `data/group-names.json` is used (this is already the default path — see `docs/group-naming-logic.md`) |

> `AERODATABOX_API_KEY` and `lib/flights.ts`'s `fetchArrivals()`/`bucketIntoPools()` are no
> longer wired into any page — Rides now runs on self-reported flights (`/rides/add`, with
> optional Claude screenshot parsing) instead of a live arrivals feed. Candidate for cleanup.

## Database

Apply migrations **in order** (`supabase/migrations/`). If you reset or recreate the DB,
re-apply all of them:

| File | What |
|------|------|
| `0001_core.sql` | 8 tables, `shares_channel()`, RLS policies, avatars bucket |
| `0002_directory.sql` | `directory_profiles` view + `can_see_contact()` |
| `0003_fix_group_members_rls.sql` | `is_group_member()` security-definer (fixes RLS recursion) |
| `0004_realtime_messages.sql` | adds `messages` to the realtime publication |
| `0005_party_size.sql` | `signups.party_size` (come-as-a-group); drops old `group_size_pref` |
| `0006_flights_mentor.sql` | `flights` table (self-reported arrival/departure, powers Rides) + `profiles.mentor_optin` |
| `0007_birthday.sql` | `profiles.birthday` (optional, collected during onboarding) |
| `0008_profiles_contact_rls.sql` | **Security fix.** Tightens `profiles` SELECT so only the owner or someone who shares a channel with them can read a row — closes a gap where any signed-in user (including guests) could read anyone's kakao/linkedin/dietary/birthday directly, bypassing the app's "contacts unlock only when you share a table" gate. Apply this one promptly. |
| `0009_event_stay.sql` | `profiles.event_id`/`stay_start`/`stay_end` (onboarding's Event & stay step) + adds the stay columns to `directory_profiles` |
| `0010_hi_requests.sql` | `hi_requests` table + RLS — People's "Say hi" request, deliberately not wired into `shares_channel()` |
| `0011_ride_join.sql` | Links `ride_pools` to `flights` (`anchor_flight_id`) + adds the missing insert policy — Rides' "Share" now really joins a pool (capacity 4, closes once full) instead of being a client-only stub |

Apply via the Supabase dashboard SQL editor (paste each file, Run), or the Supabase CLI.

## Scripts

```bash
# Seed real dinner slots (Wed/Thu/Fri dinners + Sat lunch)
npx -y tsx --env-file=.env.local scripts/seed-slots.ts
# Seed ~20 fake users onto Day 2 Dinner (for testing matching)
npx -y tsx --env-file=.env.local scripts/seed-fake.ts
# Print a local login link for an email (no inbox needed) — dev only
node --env-file=.env.local scripts/dev-magiclink.mjs you@example.com
# Tests
npx vitest run
```

## Deploy

See the running deploy checklist in [`docs/HANDOFF.md`](docs/HANDOFF.md#deploy-to-vercel-checklist).

## Docs

- `docs/HANDOFF.md` — build status, DB state, deploy checklist, human TODOs.
- `docs/UX-GAP-AUDIT.md` — prioritized conference-goer gap list.
- `docs/group-naming-logic.md` — how tables get playful names instead of "Table N".
- `docs/mentor-match-logic.md` — mentor/mentee role derivation and pairing logic.
- `docs/superpowers/specs/` — design specs (product spec, party-size).

---

## User pipeline — the states a person moves through

```
Landing (/)                → redirects to /home
   │  not signed in
   ▼
Login (/login)             → enter email → magic link → tap it
   │  first time (no profile)          returning
   ▼                                     │
Onboarding (/welcome)                    │
   Step 1 Basics  (name, school, position, photo)
   Step 2 Interests
   Step 3 Plans   (pick dinners, optional flight info)
   │  profile saved + dinner signups created
   ▼                                     ▼
Home (/home)  ◀──────────────────────────┘
   Four states, priority top-down:
     · Day-of      → "Tonight 7:00 · <place>"  → Open chat
     · Revealed    → "Your table is set"        → Meet your table
     · Joined-wait → "Tables assigned at <time>" → Change plans
     · Fresh       → CTAs: Find your table · See who's here
   │
   ├─▶ Meals (/meals)   list slots → Join sheet ("How many are you?" 1–4 + notes) → You're in
   │        │  admin runs matching (/admin)
   │        ▼
   │     Group reveal (/groups/[id])   member cards, "+N with them", rationale, place/time
   │        │                          → Open group chat
   │        ▼
   │     Chat (/groups/[id]/chat)      realtime group chat
   │
   ├─▶ People (/people)  directory → tap a person → contacts (locked until you share a table)
   │
   ├─▶ Mentor (/mentor)  role (mentor/mentee) derived from position → opt in → daily 1:1 match
   │
   ├─▶ Rides (/rides)    post your arrival/departure flight (or screenshot a boarding pass —
   │                     Claude prefills it) → board of others near your time → "Share"
   │                     (UI-only stub today: no backend row, no contact unlock yet)
   │
   └─▶ Me (/me)          profile view/edit, my dinners, my tables, sign out
```

**Matching:** an admin opens `/admin` and runs matching for a slot. Signups are packed into
tables of 4–6 *by headcount* — a party of 3 always sits together and merges with, say, a
party of 2 into a table of 5. Claude writes each table's "why you matched" rationale and a
suggested place; if no API key is set (or validation fails), a round-robin fallback produces
correct tables with a generic rationale. Table *names* always come from the deterministic
bank in `lib/groupName.ts`, keyed off the group's shared interests/field.

**Mentor matching:** role (mentor vs. mentee) is derived from the free-text `position` field
(PhD/postdoc/industry titles → mentor, student titles → mentee). Opting in at `/mentor` adds
you to the daily 1:1 pool; matching logic lives in `lib/mentorMatch.ts`.

**Contact unlock:** KakaoTalk / LinkedIn are hidden in the directory until you and the other
person share a *meal group* **or a ride pool**, enforced in the DB by `can_see_contact()` /
`shares_channel()`. Since `0011`, joining someone's flight on Rides writes a real
`ride_members` row (capacity 4, same table `shares_channel()` already checked but nothing
used to populate), so people who share a ride now unlock contacts too — same mechanism as
sharing a table, no extra code needed for it.
