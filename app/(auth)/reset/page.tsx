"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Wordmark from "@/components/Wordmark";

export default function ResetPage() {
  const router = useRouter();
  const supabase = createClient();
  const [ready, setReady] = useState<null | boolean>(null); // null = checking
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The recovery link exchanged into a session at /auth/callback; confirm we have one.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6 || busy) return;
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    router.push("/home");
    router.refresh();
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

      {ready === false ? (
        <div style={{ padding: "18px 20px", border: "1px solid var(--line)", borderRadius: 14, background: "var(--surface)" }}>
          <p style={{ fontWeight: 700, fontSize: 16 }}>This link expired</p>
          <p style={{ color: "var(--ink-2)", marginTop: 6, fontSize: 14 }}>
            Reset links are single-use and time out. Request a fresh one.
          </p>
          <Link href="/forgot" style={{ display: "inline-block", marginTop: 14, color: "var(--accent)", fontWeight: 600 }}>
            Send a new link
          </Link>
        </div>
      ) : (
        <>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>Set a new password</h1>
          <p style={{ color: "var(--ink-2)", marginTop: 8, fontSize: 15 }}>
            Pick something you&apos;ll remember. At least 6 characters.
          </p>
          <form onSubmit={submit} style={{ marginTop: 22 }}>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={ready === null}
              className="au-uinput"
            />
            {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>{error}</p>}
            <button
              type="submit"
              disabled={busy || ready === null || password.length < 6}
              style={{
                width: "100%", minHeight: 50, marginTop: 18, border: 0, borderRadius: 12,
                background: "var(--accent-grad)", color: "var(--accent-ink)",
                fontSize: 16, fontWeight: 700, cursor: "pointer",
                opacity: busy || ready === null || password.length < 6 ? 0.5 : 1,
              }}
            >
              {busy ? "Saving…" : "Update password"}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
