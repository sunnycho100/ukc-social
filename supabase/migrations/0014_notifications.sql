-- Net new: nothing wrote a notification anywhere before this. Every insert is
-- cross-user (the actor triggering it isn't the recipient), so there's no
-- insert policy here — all writes go through the service-role client
-- (lib/supabase/service.ts), same as matchOneSlot's other privileged writes.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  type text not null check (type in ('table_revealed', 'ride_matched', 'hi_received')),
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table notifications enable row level security;

create policy notif_sel on notifications for select using (auth.uid() = user_id);
create policy notif_upd on notifications for update using (auth.uid() = user_id);

-- Realtime, so NotificationBell's dot appears live (same reason messages
-- needed this in 0004 — new tables aren't auto-added to the publication).
alter publication supabase_realtime add table notifications;
