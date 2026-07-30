-- Event & stay window, collected as onboarding step 1. Lets the app scope
-- matching to people actually at the same event, around at the same time.
-- event_id is a simple text tag for now ('ukc2026' | 'ksea2026' | 'none') —
-- not a normalized events table, since only UKC 2026 has real slots today.
--
-- NOTE: this migration only adds the columns. Nothing reads event_id or the
-- stay dates to actually filter matching/rides/join yet — see docs/HANDOFF.md
-- for the follow-up work that closes that gap.
alter table profiles add column event_id text;
alter table profiles add column stay_start date;
alter table profiles add column stay_end date;

-- directory_profiles needs the stay columns so People can show a relative
-- stay badge ("arriving early" / "staying late" / same dates) for everyone,
-- not just people the viewer already shares a channel with.
create or replace view directory_profiles with (security_invoker = false) as
  select id, name, photo_url, school, position, interests, bio, stay_start, stay_end
  from profiles;
grant select on directory_profiles to authenticated;
