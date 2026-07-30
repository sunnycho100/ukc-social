-- Fix: p_sel ("for select using (auth.role() = 'authenticated')") let ANY signed-in
-- user — including anonymous guests, since Supabase anonymous sessions are also
-- role 'authenticated' — read every column of every profile directly, including
-- kakao/linkedin. The "contacts unlock only when you share a table" gate
-- (can_see_contact / shares_channel) was only ever checked client-side in
-- PeopleBrowser; a direct REST/JS call to `.from("profiles").select("kakao,linkedin")`
-- bypassed it entirely. directory_profiles was unaffected (it runs as the view
-- owner and only ever exposed the public columns), but the raw table did not
-- actually keep kakao/linkedin private the way migration 0002's comment assumed.
--
-- Fix: restrict base-table SELECT to the owner or anyone who shares a channel with
-- them (same relation the app already promises contacts unlock on). Every existing
-- read stays correct: self-reads (Me, ProfileEditor, mentor opt-in) still work,
-- and every other current direct profiles read (GroupReveal, Chat roster,
-- home's group-member names) only ever queries members of a group the caller is
-- already in, so shares_channel() is true for all of them.

drop policy if exists p_sel on profiles;
create policy p_sel on profiles for select using (
  auth.uid() = id or shares_channel(auth.uid(), id)
);
