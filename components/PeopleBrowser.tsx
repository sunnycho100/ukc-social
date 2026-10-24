"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { sendRequest, respondToRequest, removeRequest } from "@/app/actions/hi";
import { stayRelation, STAY_LABEL, type StayWindow } from "@/lib/stay";
import { normalizeSchool } from "@/lib/schools";
import KakaoMark from "./KakaoMark";

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

const Torso = () => (
  <>
    <circle cx="9" cy="8" r="3.4" />
    <path d="M2.6 20c0-3.5 2.9-5.6 6.4-5.6s6.4 2.1 6.4 5.6" />
  </>
);

const PersonPlus = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <Torso />
    <path d="M18.5 8.5v5M16 11h5" />
  </svg>
);

const PersonCheck = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <Torso />
    <path d="M16 11l2 2 4-4" />
  </svg>
);

const PaperPlane = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 3 10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8 21 3Z" />
  </svg>
);

// The right edge of a person's row: where you stand with them, and the way to
// change it. Connected and sent are indicators rather than buttons, since
// undoing either belongs in the sheet next to the rest of the relationship.
// An incoming request opens the sheet, because accepting is a decision that
// deserves seeing who is asking.
function FriendAction({
  link,
  busy,
  name,
  onAdd,
  onOpen,
}: {
  link: Friendship | undefined;
  busy: boolean;
  name: string;
  onAdd: () => void;
  onOpen: () => void;
}) {
  if (link?.state === "friends") {
    return (
      <span className="fa fa--on" title="Connected" aria-label={`Connected with ${name}`}>
        <PersonCheck />
      </span>
    );
  }
  if (link?.state === "outgoing") {
    return (
      <span className="fa fa--sent" title="Request sent" aria-label={`Request sent to ${name}`}>
        <PaperPlane />
      </span>
    );
  }
  if (link?.state === "incoming") {
    return (
      <button type="button" className="fa fa--respond" onClick={onOpen}>
        Respond
      </button>
    );
  }
  // "declined" lands here too: it is not a permanent no, and removeRequest
  // deletes the row, so asking again stays possible.
  return (
    <button
      type="button"
      className="fa fa--add"
      onClick={onAdd}
      disabled={busy}
      title={`Add ${name}`}
      aria-label={`Add ${name} as a friend`}
    >
      <PersonPlus />
    </button>
  );
}

const SAME_SCHOOL = "Goes to the same school";

// The shape of an hi_requests row, read from either side of the pair.
type HiRow = { id: string; slug: string | null; from_user_id: string; status: string };

function toFriendship(r: HiRow, meId: string): Friendship {
  if (r.status === "accepted") return { state: "friends", id: r.id, slug: r.slug as string };
  if (r.status === "declined") return { state: "declined" };
  return r.from_user_id === meId ? { state: "outgoing", id: r.id } : { state: "incoming", id: r.id };
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

// A LinkedIn field is usually pasted as a full URL. The row wants the part a
// person recognises, so strip the scheme, the host and the /in/ prefix and show
// what is left.
function shortHandle(v: string): string {
  const trimmed = v.trim().replace(/\/+$/, "");
  const tail = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
  return tail.includes(".") ? trimmed.replace(/^https?:\/\//, "") : tail;
}

// Brand marks, drawn rather than fetched: a strict CSP and an offline-capable
// page both rule out hotlinking someone's logo CDN, and inline paths cost less
// than the network round trips. KakaoMark moved to its own file when the
// hangout board started showing it beside a member's name.
function LinkedInMark() {
  return (
    <svg className="ct-mark" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="#0A66C2"
        d="M20.45 3H3.55A.55.55 0 0 0 3 3.56v16.88c0 .31.25.56.55.56h16.9c.3 0 .55-.25.55-.56V3.56a.55.55 0 0 0-.55-.56ZM8.34 18.34H5.67V9.75h2.67v8.59ZM7 8.58a1.55 1.55 0 1 1 0-3.1 1.55 1.55 0 0 1 0 3.1Zm11.34 9.76h-2.67v-4.18c0-1 -.02-2.28-1.39-2.28-1.39 0-1.6 1.09-1.6 2.21v4.25H9.99V9.75h2.57v1.17h.03a2.82 2.82 0 0 1 2.54-1.39c2.71 0 3.21 1.78 3.21 4.1v4.71Z"
      />
    </svg>
  );
}
function InstagramMark() {
  return (
    <svg className="ct-mark" viewBox="0 0 24 24" aria-hidden focusable="false">
      <defs>
        <linearGradient id="ig-g" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FEDA75" />
          <stop offset="0.35" stopColor="#FA7E1E" />
          <stop offset="0.7" stopColor="#D62976" />
          <stop offset="1" stopColor="#4F5BD5" />
        </linearGradient>
      </defs>
      <rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5.4" fill="url(#ig-g)" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="17.1" cy="6.9" r="1.2" fill="#fff" />
    </svg>
  );
}

type Contacts =
  | { state: "loading" }
  | { state: "locked" }
  | { state: "unlocked"; kakao: string; linkedin: string; instagram: string };

type StayFilter = "all" | "early" | "late" | "same";

// Where this person stands with you. "incoming" is a request they sent that you
// have not answered, which is the only state with two buttons.
type Friendship =
  | { state: "loading" }
  | { state: "none" }
  | { state: "outgoing"; id: string }
  | { state: "incoming"; id: string }
  | { state: "friends"; id: string; slug: string }
  | { state: "declined" };

export default function PeopleBrowser({
  people,
  meId,
  myStay,
}: {
  people: Person[];
  meId: string;
  myStay: StayWindow;
}) {
  const [query, setQuery] = useState("");
  const [activeInterest, setActiveInterest] = useState<string | null>(null);
  const [activeSchool, setActiveSchool] = useState<string | null>(null);
  const [activeStay, setActiveStay] = useState<StayFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contacts>({ state: "loading" });
  const [friend, setFriend] = useState<Friendship>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<Map<string, Friendship>>(new Map());
  // Which row's add button is mid-flight, so only that one shows it.
  const [adding, setAdding] = useState<string | null>(null);

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

  // Ordered by how many people picked each one, commonest first, so the filters
  // that actually narrow the list are the ones in reach. The row scrolls
  // horizontally, and sorting alphabetically put whatever began with A at the
  // front regardless of whether anyone had chosen it. Ties fall back to
  // alphabetical so the order is stable rather than dependent on roster order.
  const byCountThenName = (counts: Map<string, number>) => (a: string, b: string) =>
    (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b);

  const allInterests = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of people) for (const i of p.interests) counts.set(i, (counts.get(i) ?? 0) + 1);
    return [...counts.keys()].sort(byCountThenName(counts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);

  const allSchools = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of people) {
      const s = p.school.trim();
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts.keys()].sort(byCountThenName(counts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);

  const relationOf = (p: Person) =>
    stayRelation({ start: p.stay_start, end: p.stay_end }, myStay);

  // Your own row is in the list, so your school comes from there rather than
  // another prop threaded down from the page.
  const mySchool = useMemo(
    () => normalizeSchool(people.find((p) => p.id === meId)?.school ?? ""),
    [people, meId],
  );

  // What to say about this person in one line. Sharing a school beats sharing
  // dates: at a conference nearly everyone is here the same days, so that line
  // carries almost nothing, while a shared school is an actual reason to say
  // hello. Arriving early, staying late and not overlapping still come first,
  // since those decide whether you can meet at all.
  //
  // Compared through normalizeSchool rather than by exact string: the picker
  // canonicalises new entries, but anything typed before it landed, or typed
  // past it, still has to match.
  const badgeOf = (p: Person): string | null => {
    const rel = relationOf(p);
    if (rel && rel !== "same") return STAY_LABEL[rel];
    if (mySchool && normalizeSchool(p.school) === mySchool) return SAME_SCHOOL;
    return rel ? STAY_LABEL[rel] : null;
  };

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

  // Where you stand with everyone, for the indicator on each row. One query no
  // matter how big the directory gets: hi_sel already restricts the table to
  // rows you are a party to, so this returns your requests and nobody else's.
  // The sheet still re-reads a single pair, because it needs the row fresh
  // immediately after acting on it.
  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("hi_requests")
        .select("id, slug, from_user_id, to_user_id, status");
      if (!alive || !data) return;
      const m = new Map<string, Friendship>();
      for (const r of data as (HiRow & { to_user_id: string })[]) {
        const other = r.from_user_id === meId ? r.to_user_id : r.from_user_id;
        m.set(other, toFriendship(r, meId));
      }
      setLinks(m);
    })();
    return () => {
      alive = false;
    };
  }, [meId]);

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

  // Reads the request between the two of you. hi_sel already limits this to rows
  // you are a party to, so the query needs no filtering of its own beyond the
  // pair. Kept client-side rather than passed down with the roster: a directory
  // of 300 people would otherwise carry 300 request lookups to render one sheet.
  async function loadFriendship(personId: string): Promise<Friendship> {
    const supabase = createClient();
    const { data } = await supabase
      .from("hi_requests")
      .select("id, slug, from_user_id, status")
      .or(`and(from_user_id.eq.${meId},to_user_id.eq.${personId}),and(from_user_id.eq.${personId},to_user_id.eq.${meId})`)
      .maybeSingle();
    if (!data) return { state: "none" };
    const id = data.id as string;
    if (data.status === "accepted") return { state: "friends", id, slug: data.slug as string };
    if (data.status === "declined") return { state: "declined" };
    return data.from_user_id === meId ? { state: "outgoing", id } : { state: "incoming", id };
  }

  async function loadContacts(personId: string) {
    const supabase = createClient();
    const { data: canSee } = await supabase.rpc("can_see_contact", { target: personId });
    if (!canSee) return setContacts({ state: "locked" });
    const { data } = await supabase
      .from("profiles")
      .select("kakao, linkedin, instagram")
      .eq("id", personId)
      .maybeSingle();
    setContacts({
      state: "unlocked",
      kakao: data?.kakao ?? "",
      linkedin: data?.linkedin ?? "",
      instagram: data?.instagram ?? "",
    });
  }

  async function openSheet(person: Person) {
    setOpenId(person.id);
    if (person.id === meId) {
      setContacts({ state: "locked" });
      setFriend({ state: "none" });
      return;
    }
    setContacts({ state: "loading" });
    setFriend({ state: "loading" });
    // Independent reads, so they run together rather than one after the other.
    const [, f] = await Promise.all([loadContacts(person.id), loadFriendship(person.id)]);
    setFriend(f);
  }

  // Contacts unlock as a side effect of accepting (shares_channel widened in
  // 0023), so the contact block has to be re-read after any change or it would
  // keep showing the lock until the sheet is closed and reopened.
  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, personId: string) {
    setBusy(true);
    const r = await fn();
    if (r.ok) {
      const [, f] = await Promise.all([loadContacts(personId), loadFriendship(personId)]);
      setFriend(f);
      setLinks((m) => new Map(m).set(personId, f));
    }
    setBusy(false);
  }

  // Sending from the list, without opening anyone. Re-reads the pair rather
  // than assuming the result, so the row carries the real request id.
  async function addFriend(personId: string) {
    setAdding(personId);
    const res = await sendRequest(personId);
    if (res.ok) setLinks((m) => new Map(m).set(personId, { state: "outgoing", id: "" }));
    const f = await loadFriendship(personId);
    setLinks((m) => new Map(m).set(personId, f));
    setAdding(null);
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

      {/* Two or more, not one or more. A row offering the only school anyone
          is from filters nothing; it is a whole strip of chrome above the list
          that cannot change what the list shows. It comes back on its own as
          soon as a second school appears. */}
      {allSchools.length > 1 && (
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
            const badge = badgeOf(person);
            const isMe = person.id === meId;
            // Your own row shows no badge, so it must keep its school: the
            // line is only redundant when the badge is actually there to say it.
            const showsSameSchool = !isMe && badge === SAME_SCHOOL;
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
                      {/* Position first: it is the short half, and the action
                          button on the right leaves little room, so leading
                          with the school truncated the stage away entirely.
                          The school drops out when the badge underneath is
                          already saying you share it, rather than printing the
                          same institution twice in two lines. */}
                      {[person.position, showsSameSchool ? "" : person.school]
                        .filter(Boolean)
                        .join(" · ") || "Not set"}
                    </div>
                    {badge && !isMe && <div className="stay-badge">{badge}</div>}
                  </div>
                </button>
                {!isMe && (
                  <FriendAction
                    link={links.get(person.id)}
                    busy={adding === person.id}
                    name={person.name || "them"}
                    onAdd={() => addFriend(person.id)}
                    onOpen={() => openSheet(person)}
                  />
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
                  {friend.state === "outgoing"
                    ? "Shared once they accept"
                    : "Connect, or share a table or ride, to see contacts"}
                </div>
              )}
              {contacts.state === "unlocked" && (
                <div className="ct-list">
                  {/* Mark on the left, handle on the right. The handle stays
                      visible rather than hiding behind the icon: KakaoTalk has
                      no link to follow, you type the ID into Kakao itself, and
                      for the other two people still want to read the handle
                      before deciding to tap. */}
                  {contacts.kakao ? (
                    <div className="ct-row">
                      <KakaoMark />
                      <span className="ct-handle">{contacts.kakao}</span>
                    </div>
                  ) : null}
                  {contacts.linkedin ? (
                    <a
                      className="ct-row ct-row--link"
                      href={
                        contacts.linkedin.startsWith("http")
                          ? contacts.linkedin
                          : `https://${contacts.linkedin}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <LinkedInMark />
                      <span className="ct-handle">{shortHandle(contacts.linkedin)}</span>
                    </a>
                  ) : null}
                  {contacts.instagram ? (
                    <a
                      className="ct-row ct-row--link"
                      href={`https://instagram.com/${contacts.instagram.replace(/^@/, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <InstagramMark />
                      <span className="ct-handle">@{contacts.instagram.replace(/^@/, "")}</span>
                    </a>
                  ) : null}
                  {!contacts.kakao && !contacts.linkedin && !contacts.instagram && (
                    <span style={{ fontSize: 14, color: "var(--ink-2)" }}>
                      No contacts added yet.
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Nothing to offer on your own card, and a declined request stays
                quiet rather than inviting another round of asking. */}
            {active.id !== meId && friend.state !== "loading" && friend.state !== "declined" && (
              <div className="fr-actions">
                {friend.state === "none" && (
                  <button
                    type="button"
                    className="fr-primary"
                    disabled={busy}
                    onClick={() => act(() => sendRequest(active.id), active.id)}
                  >
                    {busy ? "Sending…" : "Connect"}
                  </button>
                )}

                {friend.state === "outgoing" && (
                  <>
                    <span className="fr-note">
                      Request sent
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M21.5 2.5 11 13" />
                        <path d="M21.5 2.5 15 21l-4-8-8-4 18.5-6.5Z" />
                      </svg>
                    </span>
                    <button
                      type="button"
                      className="fr-quiet"
                      disabled={busy}
                      onClick={() => act(() => removeRequest(friend.id), active.id)}
                    >
                      Cancel
                    </button>
                  </>
                )}

                {friend.state === "incoming" && (
                  <>
                    <button
                      type="button"
                      className="fr-primary"
                      disabled={busy}
                      onClick={() => act(() => respondToRequest(friend.id, true), active.id)}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="fr-quiet"
                      disabled={busy}
                      onClick={() => act(() => respondToRequest(friend.id, false), active.id)}
                    >
                      Decline
                    </button>
                  </>
                )}

                {friend.state === "friends" && (
                  <>
                    <Link href={`/dm/${friend.slug}`} className="fr-primary fr-link">
                      Message
                    </Link>
                    <button
                      type="button"
                      className="fr-quiet"
                      disabled={busy}
                      onClick={() => act(() => removeRequest(friend.id), active.id)}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            )}

            <button className="ppl-close" onClick={() => setOpenId(null)}>
              Close
            </button>

            <style>{`
              .ct-list { display: flex; flex-direction: column; gap: 4px; }
              .ct-row {
                display: flex;
                align-items: center;
                gap: 10px;
                min-height: 40px;
                padding: 2px 0;
                text-decoration: none;
                color: var(--ink);
              }
              .ct-row--link .ct-handle { color: var(--accent); }
              .ct-row--link:hover .ct-handle { text-decoration: underline; }
              .ct-mark { width: 20px; height: 20px; flex-shrink: 0; }
              .ct-handle {
                font-size: 15px;
                font-weight: 600;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              }
              .fr-actions {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-top: 22px;
                padding-top: 18px;
                border-top: 1px solid var(--line);
              }
              .fr-primary {
                flex: 1;
                min-height: 46px;
                border: 0;
                border-radius: 12px;
                background: var(--accent-grad);
                color: var(--accent-ink);
                font-size: 15px;
                font-weight: 700;
                cursor: pointer;
              }
              .fr-primary:disabled { opacity: 0.5; cursor: default; }
              .fr-link {
                display: flex;
                align-items: center;
                justify-content: center;
                text-decoration: none;
              }
              .fr-quiet {
                min-height: 46px;
                padding: 0 14px;
                border: none;
                background: none;
                color: var(--ink-2);
                font-size: 15px;
                font-weight: 600;
                cursor: pointer;
              }
              .fr-quiet:hover:not(:disabled) { color: var(--ink); }
              .fr-quiet:disabled { opacity: 0.5; cursor: default; }
              .fr-note {
                flex: 1;
                display: flex;
                align-items: center;
                gap: 7px;
                font-size: 15px;
                color: var(--ink-2);
                font-weight: 600;
              }
            `}</style>
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
        .fa {
          flex-shrink: 0;
          display: grid;
          place-items: center;
          width: 40px;
          height: 40px;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: none;
        }
        .fa--add { color: var(--accent); cursor: pointer; }
        .fa--add:disabled { opacity: 0.5; cursor: default; }
        .fa--on {
          color: var(--accent-ink);
          background: var(--accent);
          border-color: var(--accent);
        }
        .fa--sent { color: var(--ink-3); }
        .fa--respond {
          width: auto;
          padding: 0 14px;
          font-size: 13px;
          font-weight: 700;
          color: var(--accent);
          border-color: var(--accent);
          cursor: pointer;
        }
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
