-- Rides "Share" becomes a real join instead of a client-only stub.
-- Reuses the ride_pools/ride_members tables from 0001, which existed but
-- were never wired to anything. Each posted flight gets its own pool,
-- created when the flight is first submitted (see submitFlight() in
-- app/actions/flights.ts); "Share" on the Rides board joins that pool.
-- Capacity stays at ride_pools' existing default of 4 — the board hides
-- the join action (shows "Full") once a pool's member count hits it.
alter table ride_pools add column anchor_flight_id uuid unique references flights on delete cascade;

-- 0001 only ever granted select on ride_pools (rp_sel) — nothing could
-- create one under RLS. Anyone signed in can open a pool for their own
-- flight or find one to join.
create policy rp_ins on ride_pools for insert with check (auth.role() = 'authenticated');
