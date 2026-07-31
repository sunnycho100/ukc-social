# 06. Group reveal, chat, and unread

Index: [README.md](README.md) · Test-id prefix: `CHAT`

**Files**

| File | Role |
|---|---|
| `app/groups/[id]/page.tsx` | the reveal: fetch group, members, party sizes |
| `components/GroupReveal.tsx` | the reveal UI and first-visit animation |
| `app/groups/[id]/chat/page.tsx` | marks read, fetches roster, renders `Chat` |
| `components/Chat.tsx` | history, realtime, optimistic send, roster sheet |
| `app/(tabs)/chat/page.tsx` | the thread index with unread counts |
| `app/actions/messages.ts` | `sendMessage` |

---

## Scenario

Matching has run. The attendee opens their table, sees who they are seated with and
why, then opens the thread and talks to them. The thread index shows how many
messages they have not read across all their tables.

## Screen sequence

```
/home or /me or /chat or GoingSheet
   └─ /groups/{id}          reveal: name · rationale · icebreaker · meet time · member cards
        └─ /groups/{id}/chat  thread: history · realtime · composer · roster sheet
/chat                        index: one row per table, last message, unread badge
```

---

## Access control

Both group pages rely entirely on RLS. There is no explicit membership check in the
page code:

```ts
const { data: group } = await supabase.from("groups").select(...).eq("id", id).maybeSingle();
if (!group) notFound();
```

`g_sel` restricts `groups` to rows where the caller is in `group_members`. A
non-member's query returns null, indistinguishable from a group that does not exist,
and the page 404s. `gm_sel` does the same for the roster query, via the
`is_group_member` security-definer helper that migration `0003` added to break the
policy's self-recursion.

---

## The reveal

`/groups/[id]/page.tsx` runs three queries:

1. the group with its slot embedded (`title`, `starts_at`, `area`)
2. `group_members` joined to `profiles` for name, photo, school, position,
   interests, **kakao**, **linkedin**
3. `signups` for the slot, to map `user_id → party_size`

Contacts come straight from `profiles` here, with no `can_see_contact` check,
because `p_sel` already permits it: everyone at the table shares a channel, so
`shares_channel` is true for all of them. This is the payoff of migration `0008`,
which made contact privacy a database rule rather than a client-side courtesy.

`GroupReveal` animates a staggered card entrance **once per group**, keyed on
`localStorage["revealed-{groupId}"]`. Repeat visits and
`prefers-reduced-motion: reduce` render instantly with no transition.

---

## The thread

`/groups/[id]/chat/page.tsx` does four things before rendering:

1. RLS-gated group fetch, 404 on null.
2. **Upsert `message_reads`** with `last_read_at = now()` on `(user_id, group_id)`.
   This is what clears the unread badge. It is deliberately non-fatal: a failed
   upsert leaves a stale badge, not a broken page.
3. Fetch the roster (`user_id`, name, photo) to seed `Chat`.
4. Render `Chat` with `channelType="meal"`.

`Chat` then:

- **History.** Last 100 messages for `channel_id`, fetched descending and reversed,
  so it is the most recent 100 rather than the oldest 100. There is no pagination or
  "load more".
- **Realtime.** Subscribes to `postgres_changes` INSERT on `public.messages` with
  `filter: channel_id=eq.{id}`. RLS still gates who receives each row. Migration
  `0004` added `messages` to the `supabase_realtime` publication, without which
  nothing broadcasts.
- **Optimistic send.** A row with id `tmp-{Date.now()}` and `pending: true` is
  appended immediately, the draft clears, then `sendMessage` runs. On success the
  temp row is replaced by the real one, or dropped if realtime already delivered it
  (deduped by id). On failure the row stays with `failed: true` and a retry control.
- **Scroll.** Auto-scrolls to the bottom only when the user was already within 120px
  of it, so reading history is not interrupted. Your own message always scrolls into
  view, because `nearBottom` is forced true before sending.
- **Accessibility.** A polite live region announces only **incoming** messages; you
  already know what you sent. The roster sheet traps Tab, closes on Escape, and
  restores focus to the header button.

`sendMessage(channelType, channelId, body)` trims, rejects empty, rejects over 2000
characters, then inserts. RLS (`m_ins`) enforces both that the author is the caller
and that the caller is a member of the channel.

---

## Unread counting

`/chat` computes unread in application code, not SQL:

1. Read the caller's groups via `group_members`.
2. Read `message_reads` for those groups.
3. Read **all** messages for those groups with `channel_type = 'meal'`, ascending.
4. Per group: last message is the final element; unread is the count of messages
   with `created_at > last_read_at`, or **all** of them when there is no read row.
5. Sort rows by last message time descending, with `null` sorting to the epoch and
   therefore to the bottom.

Step 3 fetches every message body for every group the user is in on every page load,
which is fine at conference scale and is the obvious first thing to change if it
is not. See [`docs/scalability-plan.md`](../scalability-plan.md).

Your own messages count toward your unread total until you open the thread, since
sending does not update `message_reads`.

---

## Tables and RLS touched

| Table | Operation | Policy |
|---|---|---|
| `groups` | select | `g_sel`, members only |
| `group_members` | select, with a `profiles` embed | `gm_sel` via `is_group_member` |
| `profiles` | select through the embed, including contacts | `p_sel`, self or `shares_channel` |
| `signups` | select for party sizes | `su_sel`, any authenticated |
| `messages` | select and insert | `m_sel` / `m_ins`, channel members only |
| `message_reads` | upsert self | `mr_sel`, `mr_ins`, `mr_upd`, all self |

---

## Ride chat is built but unreachable

`messages.channel_type` allows `'ride'`, `m_sel` and `m_ins` both have a full
`ride_members` branch, and `Chat` accepts `channelType="ride"`. No page passes it.
There is no route that renders a ride thread, so ride chat exists end to end in the
schema and the component and has no entry point in the UI.

---

## Edge cases

| id | Case | Expected | Verified |
|---|---|---|---|
| `CHAT-E01` | Non-member opens `/groups/{id}` | RLS returns null, page 404s. Indistinguishable from a nonexistent group | code |
| `CHAT-E02` | Group id is not a uuid | PostgREST errors, `data` is null, 404 | code |
| `CHAT-E03` | Group exists but has no members | Empty roster, reveal renders with no cards | code |
| `CHAT-E04` | A member has no contacts saved | Empty strings render. `StepContact` warns about exactly this during onboarding | code |
| `CHAT-E05` | Second visit to the reveal | No animation. `localStorage["revealed-{id}"]` is already set | code |
| `CHAT-E06` | `prefers-reduced-motion: reduce` | No animation on the first visit either, and the key is not written | code |
| `CHAT-E07` | Thread opened, `message_reads` upsert fails | Page still renders. The unread badge on `/chat` stays stale | code |
| `CHAT-E08` | Empty or whitespace-only message | `sendMessage` returns `{ok:false, error:"Message is empty"}` after trimming. The composer also refuses to submit | code |
| `CHAT-E09` | Message over 2000 characters | Rejected server-side with "Message too long". Nothing limits the textarea client-side | code |
| `CHAT-E10` | Send fails (network, RLS) | The optimistic row stays, marked failed, with a retry that re-runs `deliver` on the same temp id | code |
| `CHAT-E11` | Realtime delivers your own message before `sendMessage` returns | Deduped by id. `deliver` sees the real id already present and removes the temp row instead of swapping | code |
| `CHAT-E12` | Realtime connection drops | No reconnect or refetch logic. Messages sent by others while disconnected appear only on reload | code |
| `CHAT-E13` | More than 100 messages in a thread | Only the most recent 100 load. No pagination | code |
| `CHAT-E14` | A sender is not in the seeded roster | `loadProfiles` fetches them by id on demand. Until it resolves the name renders as "…" | code |
| `CHAT-E15` | User is scrolled up reading history when a message arrives | No auto-scroll. The 120px threshold decides | code |
| `CHAT-E16` | User sends while scrolled up | `nearBottom` is forced true, so their own message scrolls into view | code |
| `CHAT-E17` | User is in no groups | `/chat` shows "No conversations yet, join a dinner or ride to start one." | code |
| `CHAT-E18` | Group has no messages | Row shows "No messages yet.", no timestamp, unread 0, and sorts to the bottom | code |
| `CHAT-E19` | Group has messages but no `message_reads` row | **Every** message counts as unread | code |
| `CHAT-E20` | User's own messages since last opening the thread | Counted as unread. Sending does not touch `message_reads` | code |
| `CHAT-E21` | Matching re-runs and moves the user to a different table | The old `message_reads` row survives with a dangling meaning, and the user loses access to the old thread because `group_members` was cascade-deleted | code |
| `CHAT-E22` | `message_reads` table does not exist (migration 0013 unapplied) | The upsert errors, uncaught, on the chat page. The `/chat` index query also errors and `reads` is null, so everything reads as fully unread | flag |
| `CHAT-E23` | Escape pressed with the roster sheet open | Closes, focus returns to the header button | code |
