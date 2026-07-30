import Link from "next/link";

// Shown in place of a write surface when an anonymous guest tries to act.
export default function SignupGate({ title, blurb }: { title: string; blurb: string }) {
  return (
    <section style={{ padding: "24px 20px 48px", maxWidth: 460, margin: "0 auto" }}>
      <div className="eyebrow" style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)" }}>
        Members only
      </div>
      <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", marginTop: 10, lineHeight: 1.05, textWrap: "balance" }}>
        {title}
      </h1>
      <p style={{ marginTop: 12, fontSize: 15, color: "var(--ink-2)", lineHeight: 1.5, maxWidth: "40ch" }}>
        {blurb} Creating an account takes a few seconds. You can keep looking around either way.
      </p>
      <Link
        href="/login"
        style={{
          display: "block",
          textAlign: "center",
          marginTop: 24,
          minHeight: 50,
          lineHeight: "50px",
          borderRadius: 12,
          background: "var(--accent-grad)",
          color: "var(--accent-ink)",
          fontSize: 16,
          fontWeight: 700,
        }}
      >
        Create your account
      </Link>
    </section>
  );
}
