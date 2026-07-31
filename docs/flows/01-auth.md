# 01. Auth

Index: [README.md](README.md) · Test-id prefix: `AUTH`

Four ways in: email and password, Google OAuth, a password reset link, and an
anonymous guest session. All four converge on a Supabase session cookie that
`middleware.ts` refreshes on every request.

**Files**

| File | Role |
|---|---|
| `app/(auth)/login/page.tsx` | sign-in and sign-up, Google, guest, confirmation-sent state |
| `app/(auth)/forgot/page.tsx` | request a reset link |
| `app/(auth)/reset/page.tsx` | set a new password |
| `app/auth/callback/route.ts` | exchange an OAuth code or email token for a session, then route |
| `middleware.ts` | refresh the session cookie |
| `lib/supabase/server.ts` | `requireUser()`, the gate every protected page uses |
| `components/SignupGate.tsx`, `components/GuestBanner.tsx` | guest-facing surfaces |

No server actions are involved. Every auth call is made from the browser client
against Supabase Auth directly.

---

## Scenario A: sign up with email and password

**Screens:** `/login` (mode `signup`) → confirmation-sent card → email → `/auth/callback` → `/welcome`

| # | Step | Code |
|---|---|---|
| 1 | User toggles to "Create an account" | `setMode("signup")`, local state only |
| 2 | Submits email and password (`minLength=6`) | `supabase.auth.signUp({ email, password, options: { emailRedirectTo: origin + "/auth/callback" } })` |
| 3a | Confirmation required (no session returned) | `setSent(true)`, cooldown starts at 30s |
| 3b | Confirmation disabled (session returned) | `router.push("/welcome")` |
| 4 | User opens the mail link | lands on `/auth/callback?token_hash=…&type=signup` |
| 5 | Callback verifies | `supabase.auth.verifyOtp({ token_hash, type })` |
| 6 | Callback routes | `profiles` row exists → `/home`, else → `/welcome` |

The `profiles` lookup in step 6 is the **only** thing that decides whether a user
sees onboarding. There is no explicit "onboarded" flag.

## Scenario B: sign in

`supabase.auth.signInWithPassword` then `router.push("/home")` and
`router.refresh()`. The refresh matters: Server Components would otherwise render
from the pre-auth cache.

## Scenario C: Google

`supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: origin + "/auth/callback" } })`.
On success the browser leaves for Google, so `busy` is deliberately never cleared.
The return trip arrives at `/auth/callback?code=…` and is exchanged with
`exchangeCodeForSession`.

## Scenario D: forgot and reset

**Screens:** `/login` → `/forgot` → mail → `/auth/callback?next=/reset` → `/reset` → `/home`

| # | Step | Code |
|---|---|---|
| 1 | Enter email at `/forgot` | `resetPasswordForEmail(email, { redirectTo: origin + "/auth/callback?next=/reset" })` |
| 2 | Always shows the same confirmation | copy is deliberately conditional: "If X has an account…" |
| 3 | Callback verifies the recovery token | branches on `next` **or** `type === "recovery"`, both route to `/reset` |
| 4 | `/reset` confirms a session exists | `getSession()`, `ready` is `null` while checking |
| 5 | Submit new password | `supabase.auth.updateUser({ password })` then `/home` |

`/reset` has three render states driven by `ready`: `null` renders the form with the
input disabled, `false` renders "This link expired", `true` renders the live form.

## Scenario E: guest

"Look around first" calls `supabase.auth.signInAnonymously()` and pushes `/people`.
The resulting session has `user.is_anonymous === true` but role `authenticated`,
so it satisfies every `auth.role() = 'authenticated'` policy in the database.
Guest restriction is therefore entirely app-level:

| Surface | Behavior for a guest |
|---|---|
| `(tabs)/layout.tsx` | renders `GuestBanner`, hides `NotificationBell` |
| `/me` | renders `SignupGate` instead of the profile |
| `/home` | renders `GuestHomeSection` |
| `/meals` | Join button routes to `/login` instead of opening the sheet |
| `/people` | fully browsable, "Say hi" still gated by `sayHi`'s own checks |

---

## Error copy mapping

`friendly()` in `login/page.tsx` rewrites Supabase messages. Anything unmatched is
shown verbatim.

| Supabase message contains | Shown to the user |
|---|---|
| `provider is not enabled` / `unsupported provider` | "Google sign-in isn't switched on yet. Use email for now." |
| `anonymous` | "Guest mode isn't switched on yet. Sign in with email." |
| `invalid login credentials` | "That email and password don't match." |
| `email not confirmed` | "Confirm your email first. Check your inbox." |
| `already registered` | "That email already has an account. Sign in instead." |

---

## Tables and RLS touched

Auth itself writes only `auth.users`, which the app never queries directly. The
callback reads `profiles` with `.select("id").eq("id", user.id).maybeSingle()`,
which passes the `p_sel` self clause.

No `profiles` row is created at sign-up. It is created by the first `saveProfile`
call in onboarding step 1. A user who signs up and quits has an `auth.users` row and
no `profiles` row, and will be routed to `/welcome` on every subsequent login.

---

## Edge cases

| id | Case | Expected | Verified |
|---|---|---|---|
| `AUTH-E01` | Sign up with an email that already has an account | Supabase returns a decoy user with `identities.length === 0` and sends no mail. The form detects this, switches to `signin` mode, and shows "That email already has an account. Sign in below." No dead-end inbox screen. | code |
| `AUTH-E02` | Sign up when email confirmation is disabled in Supabase | `data.session` is present, so the confirmation card is skipped and the user goes straight to `/welcome` | code |
| `AUTH-E03` | Resend confirmation pressed twice quickly | Button is disabled for 30s (`RESEND_COOLDOWN_S`), label shows the countdown | code |
| `AUTH-E04` | Password shorter than 6 characters | Blocked by `minLength={6}` on the input. Server-side, Supabase rejects it and the raw message is shown | code |
| `AUTH-E05` | Google provider not enabled in the Supabase project | `friendly()` maps it to "Google sign-in isn't switched on yet" and `busy` is cleared so the form stays usable | code |
| `AUTH-E06` | Anonymous sign-in not enabled in the project | Same pattern, mapped to "Guest mode isn't switched on yet" | code |
| `AUTH-E07` | Callback receives neither `code` nor `token_hash` | `authed` stays false, redirect to `/login?error=auth`, which renders "That link didn't work. Try again." | code |
| `AUTH-E08` | Callback token is expired or already used | `verifyOtp` errors, same `/login?error=auth` redirect | code |
| `AUTH-E09` | Recovery link opened but `next` param stripped | `type === "recovery"` alone still routes to `/reset` | code |
| `AUTH-E10` | `/reset` opened directly with no session | `getSession()` returns null, `ready === false`, "This link expired" with a link back to `/forgot` | code |
| `AUTH-E11` | `/reset` submitted while the session check is still pending | Submit is disabled while `ready === null` | code |
| `AUTH-E12` | Reset requested for an email with no account | Same confirmation screen either way. This is intentional, it prevents account enumeration | code |
| `AUTH-E13` | Signed-in user visits `/login` | No redirect. The page renders normally and a fresh sign-in overwrites the session | code |
| `AUTH-E14` | Protected page hit with no session | `requireUser()` calls `redirect("/login")`. There is no `next` param, so the original destination is lost | code |
| `AUTH-E15` | Guest hits a write surface | `SignupGate` renders with a hardcoded `href="/login"`. After signing up the user lands on `/home`, not back where they were. Known regression, see README §7 | code |
| `AUTH-E16` | User signs up, never onboards, logs in again | Callback finds no `profiles` row and routes to `/welcome` every time | code |
| `AUTH-E17` | Session expires mid-session | `middleware.ts` refreshes on the next request. If the refresh token is dead, the next `requireUser()` redirects to `/login` | code |
| `AUTH-E18` | Guest signs up for a real account | A new `auth.users` row is created. The anonymous session's identity is **not** linked or migrated, so anything done as a guest is orphaned | code |
