-- Generalizes the app off a single hardcoded conference ("UKC 2026") into an
-- admin-registered row. In practice this is a singleton per deployment (one
-- fork = one conference) but modeled as a table, editable from /admin,
-- instead of a code constant. Also carries the auto-matching schedule
-- (matching_interval_minutes, last_auto_match_at) that the cron route
-- (app/api/cron/auto-match) reads/writes.
create table conferences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- IANA id, used for *display* formatting (Intl.DateTimeFormat handles DST
  -- correctly from this alone).
  timezone text not null default 'America/New_York',
  -- Fixed UTC offset (e.g. '-04:00'), used only to parse a wall-clock
  -- datetime-local input into an instant when a flight is submitted
  -- (app/actions/flights.ts) — a plain admin-set string, same trick the
  -- old hardcoded EVENT_OFFSET used, not DST-computed from `timezone`.
  utc_offset text not null default '-04:00',
  airport_code text not null default '',
  auto_matching_enabled boolean not null default false,
  matching_interval_minutes int not null default 360 check (matching_interval_minutes > 0),
  last_auto_match_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

alter table conferences enable row level security;

-- Public read: name/dates/location/timezone/airport aren't sensitive, and are
-- needed by the login page + root metadata before a user is signed in.
-- All writes go through the service-role client after an app-level
-- ADMIN_EMAIL check (app/actions/conference.ts), same as runMatching()
-- already does for groups/group_members — no insert/update/delete policy
-- is granted here.
create policy c_sel on conferences for select using (true);
