"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sayHi } from "@/app/actions/hi";
import { stayRelation, STAY_LABEL, type StayWindow } from "@/lib/stay";

export type Person = {
  id: string;
  name: string;
  photo_url: string | null;
  school: string;
  position: string;
  interests: string[];
  bio: string;
  stay_start?: string | null;
  stay_end?: string | null;
};

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "·";
}

function Avatar({ person, size }: { person: Person; size: number }) {
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        border: "1px solid var(--line)",
        background: person.photo_url
          ? `center/cover no-repeat url("${person.photo_url}")`
          : "var(--surface)",
        color: "var(--ink-2)",
        display: "grid",
        placeItems: "center",
        fontSize: size * 0.36,
        fontWeight: 600,
        overflow: "hidden",
      }}
    >
      {!person.photo_url && initials(person.name)}
    </div>
  );
}

type Contacts =
  | { state: "loading" }
  | { state: "locked" }
  | { state: "unlocked"; kakao: string; linkedin: string };

type StayFilter = "all" | "early" | "late" | "same";

export default function PeopleBrowser({
  people,
  meId,
  isGuest,
  myStay,
  hiSent,
}: {
  people: Person[];
  meId: string;
  isGuest: boolean;
  myStay: StayWindow;
  hiSent: string[];
}) {
  const [query, setQuery] = useState("");
  const [activeInterest, setActiveInterest] = useState<string | null>(null);
  const [activeSchool, setActiveSchool] = useState<string | null>(null);
  const [activeStay, setActiveStay] = useState<StayFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contacts>({ state: "loading" });
  const [sentIds, setSentIds] = useState<Set<string>>(() => new Set(hiSent));
  const [hiErrorId, setHiErrorId] = useState<string | null>(null);

  const sheetRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  // Dialog a11y (parity with the other sheets): focus in on open, restore to
  // the opener on close, Escape closes, Tab trapped inside.
  useEffect(() => {
    if (!openId) return;
    openerRef.current = document.activeElement;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setOpenId(null);
      if (e.key !== "Tab" || !sheetRef.current) return;
      const nodes = sheetRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const a = document.activeElement;
      if (e.shiftKey && (a === first || a === sheetRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && a === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [openId]);

  const allInterests = useMemo(() => {
    const set = new Set<string>();
    for (const p of people) for (const i of p.interests) set.add(i);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [people]);

  const allSchools = useMemo(() => {
    const set = new Set<string>();
    for (const p of people) if (p.school.trim()) set.add(p.school.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [people]);

  const relationOf = (p: Person) =>
    stayRelation({ start: p.stay_start, end: p.stay_end }, myStay);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (activeInterest && !p.interests.includes(activeInterest)) return false;
      if (activeSchool && p.school !== activeSchool) return false;
      if (activeStay !== "all" && relationOf(p) !== activeStay) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) || p.school.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, query, activeInterest, activeSchool, activeStay, myStay]);

  const active = people.find((p) => p.id === openId) ?? null;

  if (people.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/empty-people.svg"
          alt=""
          width={140}
          height={105}
          style={{ display: "block", margin: "0 auto" }}
        />
        <p style={{ fontSize: 17, fontWeight: 600, marginTop: 16 }}>You&apos;re early</p>
        <p style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>
          No one else has set up a profile yet. Check back soon. This fills up as
          people arrive.
        </p>
      </div>
    );
  }

  async function openSheet(person: Person) {
    setOpenId(person.id);
    if (person.id === meId) {
      setContacts({ state: "locked" });
      return;
    }
    setContacts({ state: "loading" });
    const supabase = createClient();
    const { data: canSee } = await supabase.rpc("can_see_contact", {
      target: person.id,
    });
    if (!canSee) {
      setContacts({ state: "locked" });
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("kakao, linkedin")
      .eq("id", person.id)
      .maybeSingle();
    setContacts({
      state: "unlocked",
      kakao: data?.kakao ?? "",
      linkedin: data?.linkedin ?? "",
    });
  }

  async function handleSayHi(id: string) {
    setHiErrorId(null);
    setSentIds((s) => new Set(s).add(id));
    const res = await sayHi(id);
    if (!res.ok) {
      setSentIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      setHiErrorId(id);
    }
  }

  const STAY_FILTERS: { id: StayFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "early", label: "Arriving early" },
    { id: "late", label: "Staying late" },
    { id: "same", label: "Same dates" },
  ];

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name or school"
        aria-label="Search people"
        className="ppl-search"
      />

      <div className="chip-row" role="group" aria-label="Filter by stay window">
        {STAY_FILTERS.map((f) => {
          const on = activeStay === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => setActiveStay(f.id)}
              className={on ? "fchip fchip--on" : "fchip"}
            >
              {f.label}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "4px 0 4px", lineHeight: 1.5 }}>
        Say hi to anyone whose stay overlaps yours — full contacts still unlock only once
        you share a table or ride.
      </p>

      {allInterests.length > 0 && (
        <div className="chip-row">
          {allInterests.map((interest) => {
            const on = activeInterest === interest;
            return (
              <button
                key={interest}
                type="button"
                aria-pressed={on}
                onClick={() => setActiveInterest(on ? null : interest)}
                className={on ? "fchip fchip--on" : "fchip"}
              >
                {interest}
              </button>
            );
          })}
        </div>
      )}

      {allSchools.length > 0 && (
        <div className="chip-row">
          {allSchools.map((school) => {
            const on = activeSchool === school;
            return (
              <button
                key={school}
                type="button"
                aria-pressed={on}
                onClick={() => setActiveSchool(on ? null : school)}
                className={on ? "fchip fchip--on" : "fchip"}
              >
                {school}
              </button>
            );
          })}
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <p style={{ color: "var(--ink-2)", fontSize: 15 }}>
            No one matches those filters.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setActiveInterest(null);
              setActiveSchool(null);
              setActiveStay("all");
            }}
            style={{
              marginTop: 14,
              padding: "10px 18px",
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 600,
              border: "1px solid var(--line)",
              color: "var(--ink)",
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="ppl-grid">
          {filtered.map((person) => {
            const rel = relationOf(person);
            const isMe = person.id === meId;
            const sent = sentIds.has(person.id);
            const noOverlap = rel === "no-overlap";
            return (
              <div key={person.id} className="person-row">
                <button
                  type="button"
                  onClick={() => openSheet(person)}
                  className="person-info"
                >
                  <Avatar person={person} size={48} />
                  <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)" }}
                      >
                        {person.name || "Someone"}
                      </span>
                      {isMe && <span className="you-tag">You</span>}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--ink-2)",
                        marginTop: 3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {[person.school, person.position].filter(Boolean).join(" · ") ||
                        "Not set"}
                    </div>
                    {rel && !isMe && <div className="stay-badge">{STAY_LABEL[rel]}</div>}
                  </div>
                </button>
                {!isMe && isGuest && (
                  <div className="say-hi-col">
                    <a href="/login" className="say-hi-btn say-hi-guest">
                      Sign up to say hi
                    </a>
                  </div>
                )}
                {!isMe && !isGuest && (
                  <div className="say-hi-col">
                    <button
                      type="button"
                      className="say-hi-btn"
                      disabled={sent || noOverlap}
                      onClick={() => handleSayHi(person.id)}
                    >
                      {sent ? "Said hi ✓" : "Say hi"}
                    </button>
                    <span className="say-hi-lock">
                      {hiErrorId === person.id ? "Couldn't send — try again" : "🔒 contact locked"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {active && (
        <div className="sheet-backdrop" onClick={() => setOpenId(null)}>
          <div
            ref={sheetRef}
            tabIndex={-1}
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={active.name || "Profile"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grabber" />
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <Avatar person={active} size={64} />
              <div style={{ minWidth: 0 }}>
                <div className="ppl-name">
                  {active.name || "Someone"}
                  {active.id === meId && <span className="you-tag"> You</span>}
                </div>
                <div
                  style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 2 }}
                >
                  {[active.school, active.position].filter(Boolean).join(" · ") ||
                    "Not set"}
                </div>
              </div>
            </div>

            {active.interests.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
                {active.interests.map((i) => (
                  <span key={i} className="tag">
                    {i}
                  </span>
                ))}
              </div>
            )}

            {active.bio && (
              <p style={{ fontSize: 15, color: "var(--ink)", marginTop: 16, lineHeight: 1.5 }}>
                {active.bio}
              </p>
            )}

            <div style={{ marginTop: 22 }}>
              <div className="field-label">Contacts</div>
              {contacts.state === "loading" && (
                <div className="skel" style={{ height: 20, width: "60%" }} />
              )}
              {contacts.state === "locked" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    color: "var(--ink-2)",
                    fontSize: 14,
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Join a table or ride together to connect
                </div>
              )}
              {contacts.state === "unlocked" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {contacts.kakao ? (
                    <div style={{ fontSize: 15 }}>
                      <span style={{ color: "var(--ink-2)" }}>KakaoTalk · </span>
                      <span style={{ color: "var(--ink)", fontWeight: 600 }}>
                        {contacts.kakao}
                      </span>
                    </div>
                  ) : null}
                  {contacts.linkedin ? (
                    <a
                      href={
                        contacts.linkedin.startsWith("http")
                          ? contacts.linkedin
                          : `https://${contacts.linkedin}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 15, color: "var(--accent)", fontWeight: 600 }}
                    >
                      LinkedIn
                    </a>
                  ) : null}
                  {!contacts.kakao && !contacts.linkedin && (
                    <span style={{ fontSize: 14, color: "var(--ink-2)" }}>
                      No contacts added yet.
                    </span>
                  )}
                </div>
              )}
            </div>

            <button className="ppl-close" onClick={() => setOpenId(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      <style>{`
        /* De-boxed search — hairline underline, matching onboarding/join fields. */
        .ppl-search {
          width: 100%;
          box-sizing: border-box;
          padding: 10px 2px;
          font-size: 16px;
          background: transparent;
          color: var(--ink);
          border: none;
          border-bottom: 1px solid var(--line);
          border-radius: 0;
          outline: none;
          transition: border-color 150ms ease-out;
        }
        .ppl-search:focus { border-bottom-color: var(--accent); }
        .ppl-search::placeholder { color: var(--ink-3); }
        .ppl-name {
          font-family: var(--font-display), sans-serif;
          font-size: 22px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1;
        }
        .ppl-close {
          width: 100%; margin-top: 18px; border: none; background: transparent;
          color: var(--ink-3); font-size: 15px; padding: 12px; cursor: pointer;
        }
        .chip-row {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding: 14px 0 4px;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .chip-row::-webkit-scrollbar { display: none; }
        .fchip {
          flex-shrink: 0;
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          padding: 0 14px;
          border-radius: 999px;
          font-size: 14px;
          font-weight: 500;
          border: 1px solid var(--line);
          background: none;
          color: var(--ink-2);
          cursor: pointer;
          transition: background 150ms ease-out, color 150ms ease-out, border-color 150ms ease-out;
        }
        .fchip--on {
          border-color: var(--accent);
          background: color-mix(in srgb, var(--accent) 10%, transparent);
          color: var(--accent);
          font-weight: 600;
        }
        .person-row {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 14px 0;
          border-bottom: 1px solid var(--line);
        }
        .person-row:last-child { border-bottom: none; }
        /* Desktop web layout: single-column hairline list -> 3-col card grid.
           Same data/rows, just laid out as cards instead of dividers. */
        @media (min-width: 1024px) {
          .ppl-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
          }
          .person-row {
            align-items: flex-start;
            border: 1px solid var(--line);
            border-radius: 14px;
            padding: 16px;
          }
          .person-row:last-child { border-bottom: 1px solid var(--line); }
        }
        .person-info {
          display: flex;
          align-items: center;
          gap: 14px;
          flex: 1;
          min-width: 0;
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
        }
        .stay-badge {
          font-size: 11px;
          font-weight: 600;
          color: var(--accent);
          margin-top: 4px;
        }
        .say-hi-col {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
        }
        .say-hi-btn {
          flex-shrink: 0;
          min-height: 32px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid var(--accent);
          background: none;
          color: var(--accent);
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
          cursor: pointer;
        }
        .say-hi-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .say-hi-guest {
          display: inline-flex;
          align-items: center;
          text-decoration: none;
        }
        .say-hi-lock {
          font-size: 10px;
          color: var(--ink-3);
        }
        .you-tag {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          color: var(--accent);
        }
        .tag {
          font-size: 13px;
          font-weight: 500;
          padding: 6px 12px;
          border-radius: 999px;
          background: var(--surface);
          color: var(--ink);
          border: 1px solid var(--line);
        }
        .field-label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: var(--ink-2);
          margin-bottom: 10px;
        }
        .skel {
          border-radius: 8px;
          background: linear-gradient(90deg, var(--surface) 25%, var(--line) 37%, var(--surface) 63%);
          background-size: 400% 100%;
          animation: shimmer 1.4s ease-in-out infinite;
        }
        @keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
        .sheet-backdrop {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: var(--overlay);
          display: flex;
          align-items: flex-end;
          animation: sheet-fade 200ms ease-out;
        }
        .sheet {
          width: 100%;
          background: var(--bg);
          border-radius: 16px 16px 0 0;
          padding: 8px 20px calc(24px + env(safe-area-inset-bottom));
          box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.5);
          animation: sheet-up 300ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .sheet:focus { outline: none; }
        .grabber {
          width: 36px;
          height: 5px;
          border-radius: 999px;
          background: var(--line);
          margin: 6px auto 18px;
        }
        @keyframes sheet-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) {
          .sheet-backdrop, .sheet, .skel { animation: none; }
          .fchip { transition: none; }
        }
      `}</style>
    </div>
  );
}
