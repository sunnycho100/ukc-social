"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import Wordmark from "@/components/Wordmark";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset`,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setSent(true);
  }

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
      <div style={{ marginBottom: 20 }}>
        <Wordmark />
      </div>

      {sent ? (
        <div style={{ padding: "18px 20px", border: "1px solid var(--line)", borderRadius: 14, background: "var(--surface)" }}>
          <p style={{ fontWeight: 700, fontSize: 16 }}>Check your email</p>
          <p style={{ color: "var(--ink-2)", marginTop: 6, fontSize: 14 }}>
            If <strong>{email}</strong> has an account, a reset link is on its way. Open it on this
            device to set a new password.
          </p>
          <Link href="/login" className="fg-link" style={{ display: "inline-block", marginTop: 14 }}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>Reset your password</h1>
          <p style={{ color: "var(--ink-2)", marginTop: 8, fontSize: 15 }}>
            Enter your email and we&apos;ll send you a link to set a new one.
          </p>
          <form onSubmit={submit} style={{ marginTop: 22 }}>
            {/* The field had no label, no id and no aria-label, so it reached a
                screen reader as an unnamed text box. Sign in labels its fields
                the same way. */}
            <label
              htmlFor="forgot-email"
              style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}
            >
              Email
            </label>
            <input
              id="forgot-email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="au-uinput"
            />
            {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>{error}</p>}
            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%", minHeight: 50, marginTop: 18, border: 0, borderRadius: 12,
                background: "var(--accent-grad)", color: "var(--accent-ink)",
                fontSize: 16, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.5 : 1,
              }}
            >
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
          <p style={{ marginTop: 20, textAlign: "center", fontSize: 14 }}>
            <Link href="/login" className="fg-link">Back to sign in</Link>
          </p>
        </>
      )}
      <style>{`.fg-link { color: var(--accent); font-weight: 600; }`}</style>
    </main>
  );
}
