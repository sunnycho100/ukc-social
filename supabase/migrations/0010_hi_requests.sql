-- Lightweight "Say hi" — People directory lets anyone whose stay overlaps
-- send a low-stakes connection request. Deliberately NOT wired into
-- shares_channel()/can_see_contact(): sending or receiving a hi_request does
-- not unlock kakao/linkedin. Full contacts still require a real shared meal
-- table (0008's RLS). A request only notifies (once a recipient-facing UI
-- exists — not built yet, see docs/HANDOFF.md) that someone said hi.
create table hi_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references profiles on delete cascade,
  to_user_id uuid not null references profiles on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_user_id, to_user_id)
);
alter table hi_requests enable row level security;

create policy hi_ins on hi_requests for insert
  with check (auth.uid() = from_user_id and from_user_id <> to_user_id);
create policy hi_sel on hi_requests for select
  using (auth.uid() = from_user_id or auth.uid() = to_user_id);
