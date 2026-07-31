# 02. Onboarding

Index: [README.md](README.md) · Test-id prefix: `ONB`

Five steps at `/welcome?step=N`. One client component holds all state; the five step
components are presentational and receive `value` plus `onChange`.

**Files**

| File | Role |
|---|---|
| `app/welcome/page.tsx` | server shell, `requireUser()` and `getConference()`, wraps in `<Suspense>` |
| `components/onboarding/OnboardingClient.tsx` | all state, draft persistence, step routing, save orchestration |
| `components/onboarding/StepEvent.tsx` | 1: event choice and stay window |
| `components/onboarding/StepBasics.tsx` | 2: name, school, position, birthday, photo |
| `components/onboarding/StepInterests.tsx` | 3: interest chips |
| `components/onboarding/StepContact.tsx` | 4: bio, KakaoTalk, LinkedIn |
| `components/onboarding/StepPlans.tsx` | 5: dinner slots and flights |
| `lib/avatar.ts` | client-side image downscale before upload |
| `app/actions/profile.ts` | `saveProfile`, `setDinnerSignups` |
| `app/actions/flights.ts` | `submitFlight` |

---

## Scenario

A new user lands on `/welcome` (routed there by `/auth/callback` because no
`profiles` row exists) and walks five steps. Each step writes its own fields to
`profiles` before advancing, so an abandoned run leaves a partial profile rather
than nothing.

## Step sequence

| Step | Screen | Gate to continue | Saved on continue |
|---|---|---|---|
| 1 | "Are you here for {conference}?" plus check-in and check-out dates | an event choice is selected | `event_id`, `stay_start`, `stay_end` |
| 2 | Name, school or company, position, optional birthday, photo | `name.trim()` non-empty, no upload in flight | `name`, `school`, `position`, `birthday`, `photo_url` |
| 3 | Interest chips plus a free-text add | at least 3 selected | `interests` |
| 4 | One-line bio, KakaoTalk ID, LinkedIn | none | `bio`, `kakao`, `linkedin` |
| 5 | Dinner slot checkboxes plus optional flight times | none | see finish below |

`event_id` is set to `conference.id` when the user picks the registered conference,
and to `null` when they pick "None of these". Note the column is `text` (migration
`0009` describes it as a tag like `ukc2026`) but the value written is the
conference's uuid. Both work, since Postgres stores it as text either way, but
`isEligibleForSlot` only ever checks truthiness, never equality against a specific
conference.

## Draft persistence

Only `step` lives in the URL. Everything else lives in `useState` and is mirrored to
`localStorage` under the key **`onboarding-draft`** by a `useEffect` on every
change. On mount the initial state is read back from that key and merged over
`EMPTY`, so unknown or missing fields fall back safely.

The draft is removed only in `finish()`, after both `saveProfile` and
`setDinnerSignups` succeed. Every `localStorage` access is wrapped in `try/catch`
because private-mode and quota failures should degrade to "draft does not persist",
not a crash.

Navigation uses `router.replace`, not `push`, so stepping forward does not stack
history entries. Browser back from step 3 leaves onboarding entirely rather than
going to step 2; the in-page "Back" button is the intended control.

## Photo upload

Client-side only, no server action.

1. `downscale(file, 512)` in `lib/avatar.ts`: `createImageBitmap`, scale so the
   longest side is at most 512px, redraw to a canvas, re-encode JPEG at quality
   0.85.
2. Upload to Storage bucket `avatars`, path `${userId}/avatar.jpg`, `upsert: true`.
   The `av_ins` policy requires the first path segment to equal `auth.uid()`.
3. `getPublicUrl(path)` plus `?t=${Date.now()}` appended, because the path is stable
   across re-uploads and browsers would otherwise serve the cached old image.
4. The URL is stored in state and persisted with the rest of step 2.

Upload state is tracked separately (`idle` / `uploading` / `error`). Continue is
disabled while uploading. A failure shows "Upload failed. Retry or skip, we'll use
your initials." and does not block the step.

## Finish

`finish()` in `OnboardingClient.tsx` runs four calls in order:

1. `saveProfile({ dinners_wanted: slotIds })`
2. `setDinnerSignups(slotIds)` which reconciles `signups` to exactly that set
3. `submitFlight({ direction: "arrival", … })` if an arrival time was entered
4. `submitFlight({ direction: "departure", … })` if a departure time was entered

Only 1 and 2 gate success. The flight calls are awaited but their results are
discarded: flights are optional and editable later on `/me`, so a flight failure
must not trap someone in onboarding. On success the draft is cleared and the user is
pushed to `/home`.

`setDinnerSignups` is a reconcile, not an insert. It upserts the chosen slots with
`ignoreDuplicates: true`, then reads every `kind = 'meal'` slot and deletes the
user's signups for any slot not in the list. Restricting the delete to
`kind = 'meal'` is what keeps non-meal signups untouched.

## Tables and RLS touched

| Table | Operation | Policy |
|---|---|---|
| `profiles` | upsert self, once per step | `p_ins` (self), `p_upd` (self) |
| `slots` | select `kind = 'meal'` from the browser client in step 5 | `s_sel` (any authenticated) |
| `signups` | insert-ignore plus delete in `setDinnerSignups` | `su_ins`, `su_del` (self) |
| `flights` | upsert on `(user_id, direction)` | `f_ins`, `f_upd` (self) |
| `ride_pools`, `ride_members` | created as a side effect of `submitFlight` | see [07-rides.md](07-rides.md) |
| `storage.objects` | avatar upload | `av_ins`, own folder only |

---

## Edge cases

| id | Case | Expected | Verified |
|---|---|---|---|
| `ONB-E01` | No conference registered | Step 1 shows only "None of these" plus the text "No conference is set up yet, ask an admin to register one in /admin". Stay dates are not pre-filled. | code |
| `ONB-E02` | User picks the conference | Stay dates are pre-filled from `conference.starts_at` / `ends_at` **only if both are still empty**, so a returning user's own dates are never overwritten | code |
| `ONB-E03` | User picks "None of these" | `event_id` saves as `null`. `isEligibleForSlot` then returns false for every slot, so they can still join dinners but will never be seated by the matcher | code |
| `ONB-E04` | Stay dates left blank | Saved as `null`. `isEligibleForSlot` treats missing dates as "do not block" and returns true | unit |
| `ONB-E05` | Check-out earlier than check-in | Prevented in the UI by `min` / `max` on the two date inputs. Nothing enforces it server-side or in the database | code |
| `ONB-E06` | Step 2 continue with an empty name | Button disabled (`nameValid`). Whitespace-only is also rejected because the check is on `.trim()` | code |
| `ONB-E07` | Photo upload fails | `upload === "error"`, inline retry offered, step still completable. `photo_url` stays empty and initials render instead | code |
| `ONB-E08` | Continue pressed while a photo is still uploading | Disabled until upload settles | code |
| `ONB-E09` | Non-image file chosen | `accept="image/*"` filters the picker; a file that slips through fails in `createImageBitmap` and lands in the `error` state | code |
| `ONB-E10` | Fewer than 3 interests | Continue disabled, sub-line shows "3+ to continue" in accent | code |
| `ONB-E11` | Custom interest added that duplicates a seed chip | `addCustom` checks `value.includes(t)` first, so nothing is duplicated | code |
| `ONB-E12` | Custom interest not in `SEED` | Rendered as an extra chip appended after the seeds, so it survives a re-render | code |
| `ONB-E13` | Step 4 with neither Kakao nor LinkedIn | Allowed. An inline nudge warns that tablemates will see "no contacts yet". Continue is **not** blocked | code |
| `ONB-E14` | Page refreshed mid-flow | Draft restored from `localStorage`, `step` restored from the URL | code |
| `ONB-E15` | `localStorage` unavailable (private mode, quota) | Every access is try/caught. The flow works, the draft just does not survive a refresh | code |
| `ONB-E16` | `?step=0`, `?step=9`, or `?step=abc` | Clamped by `Math.min(TOTAL_STEPS, Math.max(1, Number(...) \|\| 1))`, so it lands on 1 or 5 | code |
| `ONB-E17` | User deep-links to `?step=5` without doing 1 to 4 | Renders step 5. Nothing enforces order. Their `profiles` row will be missing everything the skipped steps write | code |
| `ONB-E18` | No meal slots exist at step 5 | "Dinner slots open soon." Finish still works and creates no signups | code |
| `ONB-E19` | Flight disclosure opened with no times entered | Defaults are pre-filled to the conference start and end dates at 12:00 local, to avoid a cold empty `datetime-local` | code |
| `ONB-E20` | `submitFlight` fails during finish | Ignored. Onboarding completes and the user reaches `/home`. Flights are editable on `/me` | code |
| `ONB-E21` | `setDinnerSignups` fails | Error shown, draft **not** cleared, user stays on step 5 and can retry | code |
| `ONB-E22` | User re-runs onboarding after completing it | `saveProfile` upserts, so fields are overwritten. `setDinnerSignups` reconciles, so previously chosen dinners not re-selected are **deleted** | code |
| `ONB-E23` | Conference exists but `timezone` is unset | Column has a default of `America/New_York`, so slot times still format | code |
