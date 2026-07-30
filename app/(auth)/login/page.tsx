"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Wordmark from "@/components/Wordmark";

const RESEND_COOLDOWN_S = 30;

type Mode = "signin" | "signup";

function friendly(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("provider is not enabled") || m.includes("unsupported provider"))
    return "Google sign-in isn't switched on yet. Use email for now.";
  if (m.includes("anonymous")) return "Guest mode isn't switched on yet. Sign in with email.";
  if (m.includes("invalid login credentials")) return "That email and password don't match.";
  if (m.includes("email not confirmed")) return "Confirm your email first. Check your inbox.";
  if (m.includes("already registered")) return "That email already has an account. Sign in instead.";
  return msg;
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "email" | "google" | "guest" | "resend">(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(params.get("error") === "auth" ? "That link didn't work. Try again." : "");
  const [cooldown, setCooldown] = useState(0);
  const [conferenceName, setConferenceName] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("conferences")
      .select("name")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data?.name) setConferenceName(data.name);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resend() {
    setBusy("resend");
    setError("");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(null);
    if (error) return setError(friendly(error.message));
    setCooldown(RESEND_COOLDOWN_S);
  }

  async function withGoogle() {
    setBusy("google");
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(friendly(error.message));
      setBusy(null);
    }
    // On success the browser redirects to Google; nothing else to do.
  }

  async function asGuest() {
    setBusy("guest");
    setError("");
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      setError(friendly(error.message));
      setBusy(null);
      return;
    }
    router.push("/people");
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password || busy) return;
    setBusy("email");
    setError("");

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      setBusy(null);
      if (error) return setError(friendly(error.message));
      // Anti-enumeration: signing up an email that already exists returns a
      // decoy user with an empty identities array and sends no mail. Catch it
      // so we don't show a dead-end "check your inbox" for an existing account.
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        setMode("signin");
        return setError("That email already has an account. Sign in below.");
      }
      // Confirmation required → no session yet.
      if (!data.session) {
        setSent(true);
        setCooldown(RESEND_COOLDOWN_S);
        return;
      }
      router.push("/welcome");
      router.refresh();
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setBusy(null);
      if (error) return setError(friendly(error.message));
      router.push("/home");
      router.refresh();
    }
  }

  if (sent) {
    return (
      <Shell>
        <div className="au-card">
          <p style={{ fontWeight: 700, fontSize: 16 }}>Confirm your email</p>
          <p style={{ color: "var(--ink-2)", marginTop: 6, fontSize: 14 }}>
            We sent a confirmation link to <strong>{email}</strong>. Tap it to finish
            creating your account, then come back and sign in.
          </p>
          {error && <p className="au-error">{error}</p>}
          <button
            type="button"
            className="au-resend"
            onClick={resend}
            disabled={busy === "resend" || cooldown > 0}
          >
            {busy === "resend"
              ? "Sending…"
              : cooldown > 0
                ? `Resend email · available in ${cooldown}s`
                : "Resend email"}
          </button>
          <button
            className="au-textlink"
            onClick={() => { setSent(false); setMode("signup"); setError(""); }}
            style={{ marginTop: 10, display: "block" }}
          >
            Use a different email
          </button>
          <button className="au-textlink" onClick={() => { setSent(false); setMode("signin"); }} style={{ marginTop: 14, display: "block" }}>
            Back to sign in
          </button>
        </div>
        <AuthStyles />
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="au-title">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
      <p className="au-sub">
        Dinners, rides, and people worth meeting{conferenceName ? ` at ${conferenceName}` : ""}.
      </p>

      <button className="au-google" onClick={withGoogle} disabled={!!busy} type="button">
        <GoogleMark />
        {busy === "google" ? "Opening Google…" : "Continue with Google"}
      </button>

      <div className="au-or"><span>or</span></div>

      <form onSubmit={submit}>
        <label className="au-label" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@university.edu"
          className="au-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 16 }}>
          <label className="au-label" htmlFor="password" style={{ marginTop: 0 }}>Password</label>
          {mode === "signin" && (
            <Link href="/forgot" className="au-textlink" style={{ fontSize: 13 }}>Forgot password?</Link>
          )}
        </div>
        <input
          id="password"
          type="password"
          required
          minLength={6}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
          className="au-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="au-error">{error}</p>}

        <button type="submit" className="au-primary" disabled={!!busy}>
          {busy === "email" ? "One sec…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p className="au-switch">
        {mode === "signin" ? "New to Icebreaker? " : "Already have an account? "}
        <button
          type="button"
          className="au-textlink"
          onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }}
        >
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>

      <button type="button" className="au-guest" onClick={asGuest} disabled={!!busy}>
        {busy === "guest" ? "Looking around…" : "Look around first →"}
      </button>

      <AuthStyles />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "40px 24px",
        maxWidth: 420,
        margin: "0 auto",
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <Wordmark />
      </div>
      {children}
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

function AuthStyles() {
  return (
    <style>{`
      .au-title { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
      .au-sub { color: var(--ink-2); margin-top: 8px; font-size: 15px; }
      .au-google {
        display: flex; align-items: center; justify-content: center; gap: 10px;
        width: 100%; min-height: 50px; margin-top: 24px;
        border: 1px solid var(--line); border-radius: 12px;
        background: var(--surface); color: var(--ink);
        font-size: 15px; font-weight: 600; cursor: pointer;
        transition: border-color 0.15s ease;
      }
      .au-google:hover:not(:disabled) { border-color: var(--ink-3); }
      .au-google:disabled { opacity: 0.6; cursor: default; }
      .au-or {
        display: flex; align-items: center; gap: 12px; margin: 18px 0;
        color: var(--ink-3); font-size: 13px;
      }
      .au-or::before, .au-or::after { content: ""; flex: 1; height: 1px; background: var(--line); }
      .au-label { display: block; font-size: 13px; font-weight: 600; color: var(--ink-2); }
      .au-input {
        width: 100%; margin-top: 7px; padding: 9px 2px; font-size: 16px;
        border: none; border-bottom: 1px solid var(--line); border-radius: 0;
        background: transparent; color: var(--ink); outline: none;
        transition: border-color 0.15s ease;
      }
      .au-input:focus { border-bottom-color: var(--accent); }
      .au-input::placeholder { color: var(--ink-3); }
      .au-error { color: var(--danger); font-size: 13px; margin-top: 12px; }
      .au-primary {
        width: 100%; min-height: 50px; margin-top: 20px;
        border: 0; border-radius: 12px;
        background: var(--accent-grad); color: var(--accent-ink);
        font-size: 16px; font-weight: 700; cursor: pointer;
        transition: opacity 0.15s ease;
      }
      .au-primary:disabled { opacity: 0.5; cursor: default; }
      .au-resend {
        width: 100%; min-height: 46px; margin-top: 16px;
        border: 1px solid var(--line); border-radius: 12px;
        background: transparent; color: var(--ink);
        font-size: 14px; font-weight: 700; cursor: pointer;
        transition: border-color 0.15s ease, opacity 0.15s ease;
      }
      .au-resend:hover:not(:disabled) { border-color: var(--ink-3); }
      .au-resend:disabled { opacity: 0.55; cursor: default; }
      .au-switch { margin-top: 20px; font-size: 14px; color: var(--ink-2); text-align: center; }
      .au-textlink {
        background: none; border: none; padding: 0; cursor: pointer;
        color: var(--accent); font-size: inherit; font-weight: 600;
      }
      .au-guest {
        display: block; margin: 26px auto 0; min-height: 44px;
        background: none; border: none; cursor: pointer;
        color: var(--ink-3); font-size: 14px; font-weight: 600;
      }
      .au-guest:hover:not(:disabled) { color: var(--ink-2); }
      .au-card {
        margin-top: 24px; padding: 18px 20px;
        border: 1px solid var(--line); border-radius: 14px; background: var(--surface);
      }
    `}</style>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
