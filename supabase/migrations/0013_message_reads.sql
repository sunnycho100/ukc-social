-- Per-user read-state for group/ride chat, so the new /chat index (app/(tabs)/chat)
-- can show an unread count per thread. Nothing tracked this before — messages had no
-- reader/read_at concept at all.
create table message_reads (
  user_id uuid not null references profiles on delete cascade,
  group_id uuid not null references groups on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, group_id)
);
alter table message_reads enable row level security;

create policy mr_sel on message_reads for select using (auth.uid() = user_id);
create policy mr_ins on message_reads for insert with check (auth.uid() = user_id);
create policy mr_upd on message_reads for update using (auth.uid() = user_id);
