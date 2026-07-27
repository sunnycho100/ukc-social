import Link from "next/link";

// Shown in place of a write surface when an anonymous guest tries to act.
// `next` carries the gated destination through signup so the user lands back on
// what they were trying to do, not on a generic home screen.
export default function SignupGate({
  title,
  blurb,
  next,
}: {
  title: string;
  blurb: string;
  next?: string;
}) {
  const href = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <section style={{ padding: "24px 20px 48px", maxWidth: 460, margin: "0 auto" }}>
      <header className="page-head">
        <p className="page-kicker">Members only</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-sub">{blurb}</p>
      </header>
      <p style={{ marginTop: 10, fontSize: 14, color: "var(--ink-3)", lineHeight: 1.5, maxWidth: "40ch" }}>
        Creating an account takes a few seconds. You can keep looking around either way.
      </p>
      <Link
        href={href}
        className="ob-primary"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 24,
          textDecoration: "none",
        }}
      >
        Create your account
      </Link>
    </section>
  );
}
