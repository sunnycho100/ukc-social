"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Member = {
  userId: string;
  name?: string;
  photo_url?: string | null;
  school?: string;
  position?: string;
  interests?: string[];
  kakao?: string;
  linkedin?: string;
  partySize?: number;
};

const EASE = "cubic-bezier(0.16,1,0.3,1)";

function fmtContext(startsAt: string | null, area: string, timezone: string) {
  if (!startsAt) return area;
  const d = new Date(startsAt);
  const when = d.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
  return area ? `${when} · ${area}` : when;
}

function fmtTime(t: string | null, timezone: string) {
  if (!t) return "";
  return new Date(t).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

function initials(name?: string) {
  const p = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "·";
}

function Avatar({ name, url }: { name?: string; url?: string | null }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: 44,
        height: 44,
        borderRadius: "50%",
        border: "1px solid var(--line)",
        background: url ? `center/cover no-repeat url("${url}")` : "var(--surface)",
        color: "var(--ink-2)",
        display: "grid",
        placeItems: "center",
        fontSize: 16,
        fontWeight: 700,
        fontFamily: "var(--font-display), sans-serif",
        overflow: "hidden",
      }}
    >
      {!url && initials(name)}
    </span>
  );
}

export default function GroupReveal({
  groupId,
  name,
  rationale,
  starterQuestion,
  meetTime,
  slotTitle,
  slotStartsAt,
  slotArea,
  members,
  meId,
  timezone = "America/New_York",
}: {
  groupId: string;
  name: string;
  rationale: string;
  starterQuestion: string;
  meetTime: string | null;
  slotTitle: string;
  slotStartsAt: string | null;
  slotArea: string;
  members: Member[];
  meId?: string;
  timezone?: string;
}) {
  const myInterests = new Set(
    (members.find((m) => m.userId === meId)?.interests ?? []).map((x) => x.toLowerCase()),
  );
  // First-visit-only reveal: cards spring-stagger in. Repeat visits and
  // reduced-motion render instantly (no transition).
  const [visible, setVisible] = useState(false);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const key = `revealed-${groupId}`;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const firstVisit = !localStorage.getItem(key);
    if (firstVisit && !reduce) {
      setAnimate(true);
      requestAnimationFrame(() => setVisible(true));
      localStorage.setItem(key, "1");
    } else {
      setVisible(true);
    }
  }, [groupId]);

  const context = [slotTitle, fmtContext(slotStartsAt, slotArea, timezone)]
    .filter(Boolean)
    .join(" · ");

  // Real seats at the table: a member who came with friends counts for their whole party.
  const headcount = members.reduce((n, m) => n + (m.partySize ?? 1), 0);

  return (
    <section style={{ padding: "20px 20px 40px", maxWidth: 480, margin: "0 auto" }}>
      <Link
        href="/home"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 14,
          fontWeight: 600,
          color: "var(--ink-2)",
          marginBottom: 16,
        }}
      >
        ‹ Home
      </Link>
      <p
        style={{
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          color: "var(--accent)",
          letterSpacing: "0.08em",
          margin: 0,
        }}
      >
        {context}
      </p>

      <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.03em", margin: "10px 0 0" }}>
        Meet your table
      </h1>
      <p style={{ fontSize: 15, color: "var(--ink-2)", margin: "6px 0 0" }}>
        <span style={{ fontWeight: 600, color: "var(--ink)" }}>{name}</span> ·{" "}
        {headcount} {headcount === 1 ? "person" : "people"}
      </p>

      <div style={{ marginTop: 24, borderBottom: "1px solid var(--line)" }}>
        {members.map((m, i) => (
          <div
            key={m.userId}
            style={{
              display: "flex",
              gap: 12,
              padding: "16px 0",
              borderTop: "1px solid var(--line)",
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(16px)",
              transition: animate
                ? `opacity 560ms ${EASE} ${i * 110}ms, transform 560ms ${EASE} ${i * 110}ms`
                : "none",
            }}
          >
            <Avatar name={m.name} url={m.photo_url} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}>
                  {m.name}
                  {m.userId === meId && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginLeft: 8 }}>
                      you
                    </span>
                  )}
                  {(m.partySize ?? 1) > 1 && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", marginLeft: 6 }}>
                      +{(m.partySize ?? 1) - 1} with them
                    </span>
                  )}
                </div>
                {m.position && (
                  <span style={{ flexShrink: 0, fontSize: 13, color: "var(--ink-3)" }}>{m.position}</span>
                )}
              </div>
              {m.school && (
                <div style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 5 }}>{m.school}</div>
              )}

              {m.userId !== meId && m.interests && m.interests.length > 0 && (() => {
                const shared = m.interests.filter((it) => myInterests.has(it.toLowerCase()));
                return shared.length > 0 ? (
                  <div style={{ fontSize: 14, marginTop: 8 }}>
                    <span style={{ color: "var(--ink-3)" }}>you both like </span>
                    <span style={{ color: "var(--accent)", fontWeight: 600 }}>{shared.join(", ")}</span>
                  </div>
                ) : (
                  <div style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 8 }}>
                    into {m.interests.join(", ")}
                  </div>
                );
              })()}

              {(m.kakao || m.linkedin) && (
                <div style={{ display: "flex", gap: 14, marginTop: 8, alignItems: "baseline" }}>
                  {m.kakao && (
                    // Kakao is a plain ID, not a URL — show as copyable text, not a link.
                    <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
                      Kakao{" "}
                      <span style={{ fontWeight: 600, color: "var(--ink)" }}>{m.kakao}</span>
                    </span>
                  )}
                  {m.linkedin && (
                    <a
                      href={m.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}
                    >
                      LinkedIn
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {rationale && (
        <div style={{ marginTop: 24 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--accent)",
            }}
          >
            Why this table
          </div>
          <p
            style={{
              fontSize: 15,
              lineHeight: 1.5,
              color: "var(--ink-2)",
              margin: "8px 0 0",
            }}
          >
            {rationale}
          </p>
        </div>
      )}

      {meetTime && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--ink-3)",
            }}
          >
            Meet at
          </div>
          <div
            style={{
              fontFamily: "var(--font-display), sans-serif",
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              marginTop: 3,
            }}
          >
            {fmtTime(meetTime, timezone)}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4 }}>
            Where to eat is up to the table — sort it out in chat.
          </div>
        </div>
      )}

      {starterQuestion && (
        <div
          style={{
            marginTop: 16,
            padding: "14px 16px",
            borderRadius: 14,
            background: "color-mix(in srgb, var(--accent) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--accent)",
            }}
          >
            💬 Break the ice
          </div>
          <div style={{ fontSize: 15, color: "var(--ink)", marginTop: 4, lineHeight: 1.4 }}>
            {starterQuestion}
          </div>
        </div>
      )}

      <Link
        href={`/groups/${groupId}/chat`}
        style={{
          display: "block",
          marginTop: 28,
          padding: "15px 20px",
          border: "1px solid var(--accent)",
          color: "var(--accent)",
          borderRadius: 999,
          textAlign: "center",
          fontSize: 16,
          fontWeight: 700,
        }}
      >
        Open group chat ▸
      </Link>
    </section>
  );
}
