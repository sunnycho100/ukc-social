-- A third kind of ride: a hangout leaving from the hotel. Not a flight, so
-- there is no arrival or departure to sort it into, and nothing to auto-match
-- on either: you cannot infer a destination from a time. Someone declares
-- "leaving for X, out the door by Y" and other people join it.
--
-- This is a ride_pools row rather than a new table on purpose. shares_channel()
-- (0023) already counts two people in the same ride_members as a channel, so
-- joining a hangout unlocks contact handles through profiles.p_sel with no new
-- policy. messages' 'ride' channel type is scoped to ride_members the same way,
-- so the group chat at /rides/[id]/chat works the moment the pool exists. The
-- write policies fit too, without touching them: rm_ins only lets you insert
-- your own row, which is exactly open join, and rm_del only lets you delete
-- your own, which is exactly leave.
alter table ride_pools drop constraint ride_pools_direction_check;
alter table ride_pools add constraint ride_pools_direction_check
  check (direction in ('arrival', 'departure', 'hangout'));

-- Where the group is going. Stays empty on flight pools, which have no
-- destination beyond the airport code already on the row.
alter table ride_pools add column title text not null default '';

-- Flight pools have no owner on purpose (0018: a pool is not any one person's
-- row) because the matcher assembles them. A hangout is somebody's idea, so the
-- board can say whose. Display only: no policy reads this, and the creator gets
-- no powers the people who join lack, including the power to keep the group
-- alive after leaving it.
alter table ride_pools add column created_by uuid references profiles on delete set null;
