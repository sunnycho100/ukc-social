# 08. People directory and Say hi

Index: [README.md](README.md) · Test-id prefix: `PPL`

**Files**

| File | Role |
|---|---|
| `app/(tabs)/people/page.tsx` | server page plus the exported `PeopleSection()` |
| `components/PeopleBrowser.tsx` | search, three filters, person sheet, contact unlock, Say hi |
| `lib/stay.ts` | `stayRelation`, `STAY_LABEL` |
| `app/actions/hi.ts` | `sayHi` |
| migrations `0002`, `0008`, `0010` | the view, the contact-privacy policy, the hi table |

`PeopleSection()` is exported so `/home` can embed the whole browser under "Line
these up" without duplicating the queries. `/people` and Home render the same
component from the same data.

---

## Scenario

An attendee browses everyone at the conference, filters down to people in their
field, from a specific school, or whose stay overlaps theirs, opens someone's card
to read their bio, and sends a low-stakes "hi". Contacts stay hidden until they
actually share a table or a ride.

## Screen sequence

```
/people (or /home, embedded)
  ├─ search box: name or school
  ├─ stay chips:     All · Arriving early · Staying late · Same dates
  ├─ interest chips: every distinct interest across the directory
  ├─ school chips:   every distinct non-empty school
  └─ person row → sheet
        ├─ bio, school, position, interests, stay badge
        ├─ contacts: loading → unlocked (kakao, linkedin) | locked
        ├─ [Say hi] / "Said hi ✓"        (real users)
        └─ "🔒 contact locked" note      (guests see a sign-up prompt instead)
```

---

## Data source: why a view

The page reads **`directory_profiles`**, not `profiles`. The view is declared
`security_invoker = false`, so it runs as its owner and bypasses `profiles`' own
RLS, and it selects only public columns: `id, name, photo_url, school, position,
interests, bio, stay_start, stay_end`. There is no `kakao` or `linkedin` in the
view at all.

This is the whole privacy design in one line: the directory can show everyone,
because the thing it reads physically cannot contain contacts.

The page also has a fallback: if the query errors (which it will when migration
`0009` has not been applied and `stay_start` does not exist yet) it retries without
the stay columns and fills them with null.

---

## Filtering

All four filters are client-side over the full list, combined with AND:

| Filter | Rule |
|---|---|
| search | `name` or `school` contains the query, case-insensitive |
| interest | `interests.includes(activeInterest)`, exact string match |
| school | `school === activeSchool`, exact match |
| stay | `stayRelation(person, viewer) === activeStay` |

The interest and school chip lists are derived from the data itself
(`useMemo` over every person, deduped and sorted), so they always reflect who is
actually in the directory.

## Algorithm: `stayRelation(person, viewer)`

Pure, in `lib/stay.ts`, comparing two `YYYY-MM-DD` date ranges as strings:

```
either side missing start or end   → null          badge hidden
no overlap                         → "no-overlap"  "Not here while you are"
person.start < viewer.start        → "early"       "Arriving early"
person.end   > viewer.end          → "late"        "Staying late"
otherwise                          → "same"        "Here the same dates as you"
```

Order matters: "early" is checked before "late", so someone who both arrives earlier
**and** leaves later is labelled "Arriving early".

`no-overlap` is a possible return value but is **not** one of the filter chips
(`All`, `early`, `late`, `same`). Those people are visible under All and cannot be
isolated by a filter.

---

## Contact unlock

Opening a person's sheet:

1. If it is yourself, `contacts` goes straight to `locked` and no request is made.
2. Otherwise `contacts` is `loading` and the browser client calls
   `supabase.rpc("can_see_contact", { target: person.id })`.
3. False → `locked`, and nothing further is read.
4. True → read `kakao, linkedin` from **`profiles`** and render them.

`can_see_contact` is a security-definer function wrapping
`shares_channel(auth.uid(), target)`, true when the two share a `group_members` row
or a `ride_members` row.

Step 4 is doubly protected. Even if a client skipped the RPC and read `profiles`
directly, migration `0008` restricts `p_sel` to `auth.uid() = id or
shares_channel(auth.uid(), id)`. Before `0008` the policy was
`auth.role() = 'authenticated'`, meaning any signed-in user, **including an
anonymous guest**, could read every column of every profile with a direct REST call.
The RPC was the only gate and it was client-side. That hole is closed.

---

## Say hi

`sayHi(targetId)`:

```
targetId === self          → {ok:false, error:"That's you."}
insert hi_requests(from, to)
   error code 23505        → {ok:true}          already sent, idempotent
   other error             → {ok:false, error}
notify the recipient (service client, type "hi_received")
```

The insert is gated by `hi_ins`: `auth.uid() = from_user_id and from_user_id <>
to_user_id`, so the self-check is enforced in the database as well as in the action.

A hi deliberately does **not** unlock contacts. It is not part of
`shares_channel`, and migration `0010`'s comment says so explicitly. Full contacts
still require a real shared table or ride.

The UI is optimistic: the id is added to `sentIds` immediately, removed again if the
action fails, and an inline "Couldn't send, try again" replaces the locked-contact
note for that row. Already-sent ids are seeded from the server via the `hiSent` prop,
so the button reads "Said hi ✓" across reloads.

There is no recipient-facing inbox for hi requests. The only signal is the
notification.

---

## Tables and RLS touched

| Table | Operation | Policy |
|---|---|---|
| `directory_profiles` | select all | granted to `authenticated`, runs as view owner |
| `profiles` | select `kakao, linkedin` for one person, and the viewer's own stay dates | `p_sel`, self or `shares_channel` |
| `hi_requests` | select own sent, insert | `hi_sel` sender or recipient, `hi_ins` self as sender |
| `notifications` | insert | none, service client only |
| RPC `can_see_contact` | execute | granted to `authenticated` |

---

## Edge cases

| id | Case | Expected | Verified |
|---|---|---|---|
| `PPL-E01` | Directory is empty | Illustrated empty state: "You're early. No one else has set up a profile yet." | code |
| `PPL-E02` | Filters match nobody | "No one matches those filters." plus a Clear filters control | code |
| `PPL-E03` | Person has no photo | Initials from the first two name parts, uppercased, falling back to "·" | code |
| `PPL-E04` | Person has an empty name | `initials` returns "·" and the meta line falls back to a placeholder | code |
| `PPL-E05` | Viewer has no stay dates | `stayRelation` returns null for everyone, so no badge shows and the stay chips filter everyone out except under All | unit |
| `PPL-E06` | Person has no stay dates | Same, null, badge hidden for that person only | unit |
| `PPL-E07` | Stays do not overlap at all | `no-overlap`, badge reads "Not here while you are". No chip isolates these people | unit |
| `PPL-E08` | Person arrives earlier and leaves later | "early" wins, because it is checked first | unit |
| `PPL-E09` | Identical stay windows | "same" | unit |
| `PPL-E10` | Viewer opens their own card | Contacts are `locked` with no RPC call. There is no "this is you" special case beyond that | code |
| `PPL-E11` | Viewer shares a table with the person | RPC true, contacts render | code |
| `PPL-E12` | Viewer shares only a ride pool | Also true. `shares_channel` covers `ride_members` as well as `group_members` | code |
| `PPL-E13` | Contacts unlocked but both fields empty | Empty strings render. `StepContact`'s onboarding nudge exists to reduce this | code |
| `PPL-E14` | Guest views the directory | Full browsing. The Say hi button is replaced by a sign-up prompt (`isGuest` branch) | code |
| `PPL-E15` | Say hi to yourself | Blocked in the action and by the `hi_ins` policy. The UI does not render the button on your own row | code |
| `PPL-E16` | Say hi twice to the same person | Unique constraint raises `23505`, mapped to `{ok:true}`. Idempotent, no duplicate notification because the insert path is skipped | code |
| `PPL-E17` | Say hi fails for another reason | The optimistic id is removed from `sentIds` and "Couldn't send, try again" shows on that row | code |
| `PPL-E18` | Recipient looks for their hi requests | There is no inbox. `hi_sel` permits the read, but no surface performs it. The notification is the only signal | code |
| `PPL-E19` | `hi_requests` missing (migration 0010 unapplied) | The insert errors with a non-`23505` code, so the button rolls back and shows the error | flag |
| `PPL-E20` | `directory_profiles` lacks the stay columns (migration 0009 unapplied) | The first query errors and the fallback query runs without them, so the page renders with no stay badges | code |
| `PPL-E21` | Interest strings differing only by case | Treated as distinct chips. Matching is exact, not normalized | code |
| `PPL-E22` | School with leading or trailing whitespace | The chip list trims when collecting, but the filter compares `p.school !== activeSchool` untrimmed, so an untrimmed value will not match its own trimmed chip | code |
| `PPL-E23` | Sheet opened then Escape pressed | Closes, Tab is trapped while open, focus returns to the opening row | code |
