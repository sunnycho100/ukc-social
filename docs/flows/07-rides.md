# 07. Rides: flights, pools, and splitting a car

Index: [README.md](README.md) · Test-id prefix: `RIDE`

**Files**

| File | Role |
|---|---|
| `components/onboarding/StepPlans.tsx` | where a flight is first entered |
| `components/ProfileEditor.tsx` | where it is edited later, on `/me` |
| `app/actions/flights.ts` | `submitFlight`, `deleteFlight`, `joinRide` |
| `lib/rides.ts` | `Direction`, `FlightInput`, `toLocalInput` |
| `app/(tabs)/rides/page.tsx` | server page plus the exported `RidesListSection()` |
| `app/(tabs)/rides/Board.tsx` | arrivals and departures toggle, the 30-minute window |
| `app/(tabs)/rides/RiderCard.tsx` | one row, the Share button and its states |

There is no add-flight screen. `/rides/add` was removed; flights are captured at
onboarding step 5 and edited on `/me`, and every "add your flight" affordance on the
board links to `/me`.

---

## Scenario

An attendee posts when they land and when they leave. The board shows everyone
else's times; anyone flying within 30 minutes of theirs is highlighted. Pressing
Share seats them in that person's carpool, capped at 4, and notifies the riders
already in it.

## Screen sequence

```
onboarding step 5  "Flying in or out?"  → arrival and departure datetime-local
/me                ProfileEditor         → same two fields, editable
/rides (or /matching, Rides tab)
   ├─ [Arrivals] [Departures] toggle
   ├─ hint: "Highlighted flights are within 30 min of yours"  (only if you posted)
   └─ row per flight: time · name · city (IATA) · airline flight_no
        ├─ yours          → "Posted"
        ├─ already joined → "Joined ✓"
        ├─ pool at 4      → "Full"
        └─ otherwise      → [Share ▸] → joinRide
```

---

## `submitFlight`: three writes

```ts
submitFlight({ direction, localDateTime })   // localDateTime is "2026-08-04T15:30"
```

1. **Parse the wall clock.** `new Date(`${localDateTime}:00${utcOffset}`)` where
   `utcOffset` is the conference's fixed offset string, defaulting to `-04:00`. This
   is the one place the offset is used; everything else formats with the IANA
   `timezone`. The two exist separately on purpose: `Intl.DateTimeFormat` handles DST
   from the IANA id, but parsing a `datetime-local` string into an instant needs a
   concrete offset.
2. **Upsert `flights`** on `(user_id, direction)`, storing `airport` from the
   conference, `scheduled_at` as an ISO instant, and `luggage: true` hardcoded.
3. **Upsert `ride_pools`** on `anchor_flight_id`, then **upsert `ride_members`**
   with `ignoreDuplicates: true` to seat the poster in their own pool.

Step 3 is what makes Share real. Before migration `0011` the button wrote nothing
while claiming it did.

Only `direction` and the local datetime are collected. `flight_no`, `airline`,
`other_city`, and `other_iata` exist as columns and are rendered on the board, but
nothing writes them any more; matching only ever bucketed by time.

`deleteFlight(direction)` deletes the flight row. `ride_pools.anchor_flight_id` has
`on delete cascade`, which drops the pool, which cascades to `ride_members`. One
delete, three tables cleaned.

---

## The board

`RidesListSection()` builds the rows:

1. Read `flights`, filtered to `conference.airport_code` when one is set, ordered by
   `scheduled_at`.
2. Read names from **`directory_profiles`**, not a `profiles` embed. Most posters do
   not share a channel with the viewer, so `p_sel` would return nothing and every
   row would read "Someone".
3. Read `ride_pools` for those flight ids, then `ride_members` for those pools.
4. Per flight compute `full` (member count at or above `capacity`), `joined` (the
   viewer is a member), and `isMe`.

`Board.tsx` splits by direction, finds the viewer's own row, and marks every other
row `inWindow` when `Math.abs(theirTime - myTime) <= 30 minutes`. That windowing is
purely presentational: it highlights rows, it does not restrict who can join. The
highlight is `.arr-hot`, currently a 7% wash measuring 1.07:1 against the
background, effectively invisible. Known regression, see README §7.

## `joinRide`: the capacity gate

```
find the pool with anchor_flight_id = flightId
  no pool                     → {ok:false, error:"This ride isn't open yet."}
read all ride_members for it
  count >= pool.capacity      → {ok:false, error:"This ride is full.", full:true}
upsert ride_members (ignoreDuplicates)
notify every existing member except the joiner (service client)
return {ok:true, full: count + 1 >= capacity}
```

The count is re-read at join time rather than trusted from the page render, so a
stale board does not let a fifth person in. It is still a read-then-write with no
lock: two simultaneous joins on a pool at 3 can both pass the check. See `RIDE-E08`.

Notifications go through `serviceClient()` because the recipients are other riders,
not the caller, and `notifications` has no insert policy.

`RiderCard` holds its own state machine (`idle` → `joining` → `joined` / `full` /
`error`) initialized from the server-rendered `joined` prop, so the row reflects
reality on load and updates without a refetch.

---

## Tables and RLS touched

| Table | Operation | Policy |
|---|---|---|
| `flights` | select all, upsert self, delete self | `f_sel` any authenticated, `f_ins` / `f_upd` / `f_del` self |
| `ride_pools` | select all, upsert on anchor | `rp_sel` any authenticated, `rp_ins` any authenticated, **no update policy** |
| `ride_members` | select all, insert-ignore self | `rm_sel` any authenticated, `rm_ins` / `rm_del` self, **no update policy** |
| `directory_profiles` | select names | granted to `authenticated` |
| `notifications` | insert | none, service client only |
| `conferences` | select for airport, offset, timezone | `c_sel`, public |

---

## Edge cases

| id | Case | Expected | Verified |
|---|---|---|---|
| `RIDE-E01` | Submit with an empty time | `{ok:false, error:"Add your flight time."}` before any write | code |
| `RIDE-E02` | Submit an unparseable datetime | `isNaN(getTime())` → "That time didn't parse." | code |
| `RIDE-E03` | No conference registered | Offset falls back to `-04:00`, airport saves as an empty string. The board's airport filter is skipped, so all flights show | code |
| `RIDE-E04` | Conference `utc_offset` is wrong for the date (DST) | The instant is off by an hour. `utc_offset` is a plain admin-set string, not computed from `timezone` | code |
| `RIDE-E05` | Same direction submitted twice | `flights` upserts on `(user_id, direction)`. Both `f_ins` and `f_upd` exist, so the flight row itself updates fine | code |
| `RIDE-E06` | Editing an existing flight time on `/me` | Intended: the flight and its pool's `pickup_at` both move. **Flagged:** the `ride_pools` upsert on `anchor_flight_id` compiles to `ON CONFLICT DO UPDATE` and `ride_pools` has no UPDATE policy, so the second submit may be rejected after the flight row has already changed. Verify against a migrated database | flag |
| `RIDE-E07` | Share pressed on a flight with no pool | "This ride isn't open yet." Happens for flights posted before migration `0011` existed | code |
| `RIDE-E08` | Two people press Share simultaneously on a pool at 3 | Both read count 3, both pass the check, both insert. The pool ends at 5. Read-then-write with no lock or database-level capacity constraint | code |
| `RIDE-E09` | Share pressed on a pool already at capacity | `{ok:false, full:true}`, the card shows "Full" | code |
| `RIDE-E10` | Share pressed twice by the same person | `ignoreDuplicates: true` compiles to `ON CONFLICT DO NOTHING`, so it is a silent no-op success | code |
| `RIDE-E11` | Joining fills the pool | Returns `full: true` alongside `ok: true`, so the caller knows it is now closed | code |
| `RIDE-E12` | The notification insert fails | Ignored, not awaited for correctness. The join is already committed | code |
| `RIDE-E13` | Poster deletes their flight | Cascades: `ride_pools` by `anchor_flight_id`, then `ride_members`. Everyone in that carpool is silently removed with no notification | code |
| `RIDE-E14` | `flights` table missing (migration 0006 unapplied) | The query errors, the code substitutes an empty array, and the board renders its empty state instead of crashing | code |
| `RIDE-E15` | Poster has no `directory_profiles` row | Name falls back to the literal "Someone" | code |
| `RIDE-E16` | Nobody has posted in the selected direction | Empty state with a link to `/me` to add yours | code |
| `RIDE-E17` | You have not posted your own flight | The "within 30 min" hint is hidden and no row is highlighted, because there is nothing to compare to | code |
| `RIDE-E18` | Two flights exactly 30 minutes apart | Highlighted. The comparison is `<=` | code |
| `RIDE-E19` | A flight at a different airport | Filtered out when `conference.airport_code` is set, shown when it is not | code |
| `RIDE-E20` | Guest opens `/rides` | The board renders. Share calls `joinRide`, which only needs a session, so an anonymous user can join a carpool | code |
| `RIDE-E21` | The joined acknowledgement copy | Hardcoded "find each other at MCO" in `RiderCard`, a leftover from the pre-generalization single-airport build | code |
| `RIDE-E22` | `capacity` changed on a pool | Read live from the row at join time, so a manual change takes effect immediately | code |
