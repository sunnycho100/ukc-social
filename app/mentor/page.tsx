import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import SignupGate from "@/components/SignupGate";
import { MentorOptIn } from "./MentorOptIn";

// Derive mentor vs mentee from the free-text position on the profile. PhD and
// working adults mentor; students (masters/undergrad) get mentored. Anyone with
// a real job title but no student marker is treated as a mentor.
function roleFromPosition(position: string): "mentor" | "mentee" {
  const p = position.toLowerCase();
  if (/\bph\.?\s?d\b|postdoc|professor|founder|ceo|cto|director|principal|\bstaff\b/.test(p))
    return "mentor";
  if (/undergrad|bachelor|\bms\b|\bma\b|master|\bstudent\b|sophomore|junior|freshman|senior/.test(p))
    return "mentee";
  return "mentor";
}

export default async function MentorPage() {
  const { user, supabase } = await requireUser();
  if (user.is_anonymous) {
    return (
      <SignupGate
        title="Get matched one-on-one"
        blurb="We pair you with someone a step ahead on your path and make the intro."
        next="/mentor"
      />
    );
  }

  // Read position + opt-in. mentor_optin may not exist yet (migration 0006
  // pending) — fall back so the page still renders.
  let position = "";
  let optedIn = false;
  const full = await supabase
    .from("profiles")
    .select("name, position, mentor_optin")
    .eq("id", user.id)
    .maybeSingle();
  if (full.error) {
    const basic = await supabase
      .from("profiles")
      .select("name, position")
      .eq("id", user.id)
      .maybeSingle();
    if (!basic.data) redirect("/welcome");
    position = basic.data.position ?? "";
  } else {
    if (!full.data) redirect("/welcome");
    position = full.data.position ?? "";
    optedIn = !!(full.data as { mentor_optin?: boolean }).mentor_optin;
  }

  const role = roleFromPosition(position);
  const isMentor = role === "mentor";

  return (
    <section style={{ padding: "24px 20px 40px", maxWidth: 560, margin: "0 auto" }}>
      <Link href="/" className="mx-back" aria-label="Back to home">
        ‹ Home
      </Link>

      <div className="eyebrow" style={{ marginTop: 20 }}>
        1:1 matching
      </div>
      <h1
        style={{
          fontSize: 38,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          lineHeight: 1.02,
          marginTop: 10,
          textWrap: "balance",
        }}
      >
        Meet one person, properly
      </h1>

      <p style={{ marginTop: 14, fontSize: 16, color: "var(--ink-2)", lineHeight: 1.5, maxWidth: "44ch" }}>
        {isMentor
          ? "Bring someone up. We match you with a student who's where you were, and make the intro so it isn't on either of you to reach out cold."
          : "Get an hour with someone a step ahead on the path you're on. No cold DMs. We find the person and make the intro for you."}
      </p>

      <div className="mx-role">
        Based on your profile{position ? ` (${position})` : ""}, you&apos;d be matched as a{" "}
        <strong style={{ color: "var(--ink)" }}>{isMentor ? "mentor" : "mentee"}</strong>.
      </div>

      <MentorOptIn optedIn={optedIn} role={role} />

      <style>{`
        .mx-back {
          display: inline-flex;
          align-items: center;
          min-height: 44px;
          font-size: 15px;
          font-weight: 600;
          color: var(--ink-2);
        }
        .eyebrow {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--accent);
        }
        .mx-role {
          margin-top: 20px;
          padding-top: 18px;
          border-top: 1px solid var(--line);
          font-size: 14px;
          color: var(--ink-2);
          text-wrap: pretty;
        }
      `}</style>
    </section>
  );
}
