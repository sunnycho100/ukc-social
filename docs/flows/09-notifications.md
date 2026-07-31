# 09. Notifications

Index: [README.md](README.md) · Test-id prefix: `NOTIF`

The only cross-user push surface in the app. Three event types, all written by the
service client, all delivered live over Supabase Realtime.

**Files**

| File | Role |
|---|---|
| `supabase/migrations/0014_notifications.sql` | table, policies, realtime publication |
| `components/NotificationBell.tsx` | the bell, the panel, realtime, mark-all-read |
| `app/(tabs)/layout.tsx` | renders the bell for signed-in non-guests |
| `app/actions/admin.ts` | writes `table_revealed` |
| `app/actions/flights.ts` | writes `ride_matched` |
| `app/actions/hi.ts` | writes `hi_received` |

---

## The three types

| Type | Written when | Written to | Payload | Copy | Destination |
|---|---|---|---|---|---|
| `table_revealed` | a match run finishes, one per seated member | every member of every new group | `{group_id, slot_id}` | "Your table is set, say hi." | `/groups/{group_id}/chat` |
| `ride_matched` | someone joins a ride pool | every rider already in that pool, excluding the joiner | `{pool_id, joined_user_id}` | "Someone joined your ride." | `/rides` |
| `hi_received` | a hi is sent | the recipient | `{from_user_id}` | "Someone said hi to you." | `/home` |

The `type` column has a `check` constraint listing exactly these three values, so a
fourth type needs a migration.

Copy and destination live in one `COPY` map in `NotificationBell.tsx`. The payload
is typed as `Record<string, unknown>` and interpolated straight into the href, so a
missing `group_id` produces `/groups/undefined/chat`.

## Why every write uses the service client

In all three cases the actor is not the recipient. `notifications` has
`notif_sel` (self) and `notif_upd` (self) and **no insert policy at all**, which
makes that explicit: nothing running as a user session can create a notification,
by design. Every insert goes through `serviceClient()`.

All three inserts are best-effort. None of them is error-checked, and none of them
can fail its parent operation, which has already committed by that point.

---

## The bell

Rendered in `app/(tabs)/layout.tsx` only when `user && !user.is_anonymous`. Guests
never see it.

On mount:

1. `supabase.auth.getUser()` from the browser client.
2. Read the 30 most recent notifications for that user, newest first.
3. Subscribe to `postgres_changes` INSERT on `public.notifications` filtered to
   `user_id=eq.{id}`, prepending new rows and deduping by id.

Migration `0014` adds `notifications` to the `supabase_realtime` publication, which
is required for any broadcast at all, the same reason `0004` had to do it for
`messages`.

The unread count is `items.filter(n => !n.read_at).length`, computed from whatever
is loaded, so it is capped at 30 and reflects only the loaded window. "Mark all
read" updates local state optimistically, then issues
`update notifications set read_at = now() where user_id = me and read_at is null`,
which is permitted by `notif_upd`.

Notifications are never deleted and never marked read individually. Clicking one
navigates and closes the panel without changing its state.

**Cleanup note:** the realtime subscription is created inside an async IIFE and its
cleanup function is returned from that IIFE, not from the `useEffect`. The effect's
own cleanup only flips an `active` flag, so `supabase.removeChannel` is never
actually called on unmount. See `NOTIF-E09`.

---

## Tables and RLS touched

| Table | Operation | Policy |
|---|---|---|
| `notifications` | select own | `notif_sel`, self |
| `notifications` | update own `read_at` | `notif_upd`, self |
| `notifications` | insert | none, service client only |

---

## Edge cases

| id | Case | Expected | Verified |
|---|---|---|---|
| `NOTIF-E01` | Guest is signed in | The bell is not rendered at all | code |
| `NOTIF-E02` | User has no notifications | Panel shows "Nothing yet.", no dot on the bell | code |
| `NOTIF-E03` | More than 30 notifications | Only the 30 newest load, and the unread count is capped accordingly | code |
| `NOTIF-E04` | A notification arrives while the app is open | Realtime prepends it and the dot appears without a refresh | code |
| `NOTIF-E05` | The same row arrives twice | Deduped by id before prepending | code |
| `NOTIF-E06` | Mark all read pressed | Local state flips immediately, then the update runs. A failed update is not rolled back, so the UI can disagree with the database until reload | code |
| `NOTIF-E07` | A notification is clicked | Navigates and closes the panel. `read_at` is **not** set for that row individually | code |
| `NOTIF-E08` | `payload.group_id` is missing on a `table_revealed` | The href interpolates to `/groups/undefined/chat`, which 404s | code |
| `NOTIF-E09` | Component unmounts | The realtime channel is not removed, because the cleanup is returned from the inner async IIFE rather than the effect. Channels accumulate across navigations | code |
| `NOTIF-E10` | Matching re-runs for a slot | Every seated member receives a **second** `table_revealed`, including people who were already at that table | code |
| `NOTIF-E11` | Someone joins a ride pool they are already in | `joinRide` still notifies the other existing members, because the notify step is not conditional on the insert having actually inserted | code |
| `NOTIF-E12` | The joiner is the only member | `others` is empty and the insert is skipped entirely | code |
| `NOTIF-E13` | A duplicate hi is sent | The `23505` path returns early **before** the notification insert, so no second notification is created | code |
| `NOTIF-E14` | `SUPABASE_SERVICE_ROLE_KEY` is unset | `serviceClient()` constructs with `undefined` and every insert fails. Silently, since none are error-checked | code |
| `NOTIF-E15` | `notifications` table missing (migration 0014 unapplied) | The bell's initial read errors, `items` stays empty, and every write fails silently. No user-visible error | flag |
| `NOTIF-E16` | Recipient's account is deleted | `user_id` references `profiles` with `on delete cascade`, so their notifications go with them | code |
