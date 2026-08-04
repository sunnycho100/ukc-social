"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sendMessage } from "@/app/actions/messages";

type Msg = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  pending?: boolean;
  failed?: boolean;
};

type Member = { userId: string; name: string; photo_url: string | null };

const fmtTime = (timezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
const fmtDayTime = (timezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });

// A run break starts a new visual group: different speaker, or >5min gap.
const RUN_GAP_MS = 5 * 60 * 1000;
function breaksRun(m: Msg, prev?: Msg) {
  if (!prev) return true;
  if (prev.user_id !== m.user_id) return true;
  return +new Date(m.created_at) - +new Date(prev.created_at) > RUN_GAP_MS;
}

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Avatar({
  name,
  url,
  size = 32,
}: {
  name: string;
  url: string | null;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        fontSize: size * 0.36,
        fontWeight: 700,
        fontFamily: "var(--font-display), sans-serif",
        color: "var(--ink-2)",
        background: url
          ? `center/cover no-repeat url("${url}")`
          : "var(--surface)",
        border: "1px solid var(--line)",
        overflow: "hidden",
      }}
    >
      {!url && initials(name)}
    </span>
  );
}

const CHANNEL_LABEL = {
  meal: "Your table",
  ride: "Your ride",
  direct: "Your conversation",
} as const;

// Every thread offers a way out of itself, they just lead somewhere different.
// A table has its own reveal screen. A ride's details live on the Rides segment
// of 매칭, so it goes there with the segment preselected rather than to
// /groups/<poolId>, which is not a group and would 404. A direct thread has no
// detail screen of its own, so it returns to the directory it started from.
const CHANNEL_EXIT = {
  meal: { href: (id: string) => `/groups/${id}`, label: "See full profiles ▸" },
  ride: { href: () => "/matching?tab=rides", label: "See ride details ▸" },
  direct: { href: () => "/people", label: "Back to people ▸" },
} as const;

export default function Chat({
  channelType,
  channelId,
  currentUserId,
  groupId,
  groupName,
  members,
  starterQuestion,
  meetTime,
  timezone = "America/New_York",
}: {
  channelType: "meal" | "ride" | "direct";
  channelId: string;
  currentUserId: string;
  groupId: string;
  groupName: string;
  members: Member[];
  starterQuestion: string | null;
  meetTime: string | null;
  timezone?: string;
}) {
  const timeFmt = fmtTime(timezone);
  const dayTimeFmt = fmtDayTime(timezone);
  const router = useRouter();
  const supabase = useRef(createClient()).current;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Polite live region: announces only incoming messages (you already know
  // what you sent). Set from the realtime handler, so history never re-reads.
  const [announce, setAnnounce] = useState("");

  // Seed the profile lookup from the roster so senders resolve instantly —
  // no "…" flash. loadProfiles stays as a fallback for any id not in the group.
  const [profiles, setProfiles] = useState<Record<string, Member>>(() => {
    const seed: Record<string, Member> = {};
    for (const m of members) seed[m.userId] = m;
    return seed;
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const headBtnRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const nameOf = (id: string) =>
    id === currentUserId ? "You" : profiles[id]?.name ?? "…";

  const loadProfiles = useCallback(
    async (ids: string[]) => {
      const missing = ids.filter((id) => id && !profiles[id]);
      if (!missing.length) return;
      const { data } = await supabase
        .from("profiles")
        .select("id, name, photo_url")
        .in("id", missing);
      if (data?.length) {
        setProfiles((prev) => {
          const next = { ...prev };
          for (const p of data as any[])
            next[p.id] = { userId: p.id, name: p.name, photo_url: p.photo_url };
          return next;
        });
      }
    },
    [profiles, supabase],
  );

  // Initial load: last 100 messages (RLS gates reads).
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, user_id, body, created_at")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (!active) return;
      const rows = ((data as Msg[]) ?? []).slice().reverse();
      setMessages(rows);
      setLoading(false);
      loadProfiles([...new Set(rows.map((m) => m.user_id))]);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Realtime: new INSERTs on this channel. Dedupe by id against optimistic rows.
  useEffect(() => {
    const channel = supabase
      .channel(`msgs-${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const m = payload.new as Msg;
          setMessages((prev) =>
            prev.some((x) => x.id === m.id) ? prev : [...prev, m],
          );
          loadProfiles([m.user_id]);
          if (m.user_id !== currentUserId) setAnnounce(`${nameOf(m.user_id)}: ${m.body}`);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Auto-scroll to bottom — but only if the user is already near it, so we
  // don't yank someone reading history back down on every new message.
  useEffect(() => {
    if (nearBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, loading]);

  // Follow the on-screen keyboard. `interactive-widget=resizes-content` (see
  // app/layout.tsx) shrinks the viewport when the keyboard opens, but the
  // scroll area keeps its old offset, so the message you were reading ends up
  // above the fold. iOS Safari is also inconsistent about honouring the meta at
  // all, and visualViewport fires either way, which is why this is here rather
  // than left to CSS. Only pulls down if you were already at the bottom, same
  // rule as the effect above.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (nearBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  // Roster sheet dialog controls: Escape closes; focus moves into the sheet on
  // open and returns to the header button on close, so keyboard/SR users aren't
  // stranded behind the backdrop.
  useEffect(() => {
    if (!rosterOpen) return;
    const opener = headBtnRef.current;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setRosterOpen(false);
      // Trap Tab inside the sheet so focus can't slip behind the backdrop.
      if (e.key !== "Tab" || !sheetRef.current) return;
      const nodes = sheetRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
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
      opener?.focus();
    };
  }, [rosterOpen]);

  async function deliver(tempId: string, body: string) {
    const res = await sendMessage(channelType, channelId, body);
    setMessages((prev) => {
      if (res.ok && res.message) {
        const real = res.message;
        if (prev.some((m) => m.id === real.id))
          return prev.filter((m) => m.id !== tempId);
        return prev.map((m) => (m.id === tempId ? { ...real } : m));
      }
      return prev.map((m) =>
        m.id === tempId ? { ...m, pending: false, failed: true } : m,
      );
    });
  }

  async function submit() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    nearBottom.current = true; // my own message always scrolls into view
    const tempId = `tmp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        user_id: currentUserId,
        body,
        created_at: new Date().toISOString(),
        pending: true,
      },
    ]);
    setDraft("");
    await deliver(tempId, body);
    setSending(false);
  }

  function retry(m: Msg) {
    setMessages((prev) =>
      prev.map((x) =>
        x.id === m.id ? { ...x, pending: true, failed: false } : x,
      ),
    );
    deliver(m.id, m.body);
  }

  const others = members.filter((m) => m.userId !== currentUserId);
  const stack = members.slice(0, 3);
  // "You, Min, Sarah +2" — you first, then names, capped.
  const rosterLine = (() => {
    const names = ["You", ...others.map((m) => m.name.split(/\s+/)[0])];
    const shown = names.slice(0, 3).join(", ");
    const extra = names.length - 3;
    return extra > 0 ? `${shown} +${extra}` : shown;
  })();
  const meetLine = meetTime ? dayTimeFmt.format(new Date(meetTime)) : "";

  return (
    <div className="chat-root">
      <header className="chat-head">
        <button className="hit" onClick={() => router.back()} aria-label="Back">
          <svg width="11" height="18" viewBox="0 0 11 18" fill="none" aria-hidden>
            <path
              d="M9.5 1.5 2 9l7.5 7.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          ref={headBtnRef}
          className="head-id"
          onClick={() => setRosterOpen(true)}
          aria-label={
            channelType === "direct"
              ? "Open this conversation's details"
              : `${members.length} people in your ${channelType === "ride" ? "ride" : "table"}, open roster`
          }
        >
          <span className="stack">
            {stack.map((m) => (
              <span key={m.userId} className="stack-av">
                <Avatar name={m.name} url={m.photo_url} size={26} />
              </span>
            ))}
          </span>
          <span className="head-text">
            <span className="head-title">{groupName}</span>
            <span className="head-sub">{rosterLine}</span>
          </span>
          <svg
            className="head-caret"
            width="8"
            height="14"
            viewBox="0 0 8 14"
            fill="none"
            aria-hidden
          >
            <path
              d="M1.5 1.5 7 7l-5.5 5.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>

      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        {loading ? (
          <div className="skeleton" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`sk-row ${i % 2 ? "sk-mine" : ""}`}
              >
                <span
                  className="sk-bubble shimmer"
                  style={{ width: `${45 + ((i * 37) % 40)}%` }}
                />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="empty">
            <div className="empty-cluster">
              {members.slice(0, 5).map((m, i) => (
                <span
                  key={m.userId}
                  className="empty-av"
                  // Same clearance rule as .stack-av: at 52px the initials have
                  // about 12.5px of side padding and the ring spends 2, so -14
                  // was cutting into the letters of everyone after the first.
                  style={{ marginLeft: i === 0 ? 0 : -10, zIndex: 5 - i }}
                >
                  <Avatar name={m.name} url={m.photo_url} size={52} />
                </span>
              ))}
            </div>
            <h2 className="empty-title">You&apos;re matched</h2>
            <p className="empty-sub">
              {members.length} {members.length === 1 ? "person" : "people"} at{" "}
              <span style={{ color: "var(--ink)", fontWeight: 600 }}>
                {groupName}
              </span>
              . Say hi and share who you are 👋
            </p>
            {meetLine && (
              <div className="empty-plan">
                <span className="plan-kicker">Your plan</span>
                <span className="plan-line">{meetLine}</span>
              </div>
            )}
            {starterQuestion && (
              <div className="empty-plan empty-plan--starter">
                <span className="plan-kicker">💬 Break the ice</span>
                <span className="plan-line">{starterQuestion}</span>
              </div>
            )}
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const mine = m.user_id === currentUserId;
            const newRun = breaksRun(m, prev);
            const t = timeFmt.format(new Date(m.created_at));

            if (mine) {
              return (
                <div
                  key={m.id}
                  className="row mine"
                  style={{ marginTop: newRun ? 12 : 2 }}
                >
                  {newRun && <div className="meta meta-r">{t}</div>}
                  <div className="bubble bubble-mine">{m.body}</div>
                  {m.pending && <div className="status">Sending…</div>}
                  {m.failed && (
                    <div role="alert">
                      <button className="retry" onClick={() => retry(m)}>
                        Couldn&apos;t send · Retry
                      </button>
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div
                key={m.id}
                className="row them"
                style={{ marginTop: newRun ? 12 : 2 }}
              >
                {newRun ? (
                  <Avatar name={nameOf(m.user_id)} url={profiles[m.user_id]?.photo_url ?? null} />
                ) : (
                  <span className="av-spacer" />
                )}
                <div className="them-col">
                  {newRun && (
                    <div className="meta">
                      <span className="meta-name">{nameOf(m.user_id)}</span>
                      <span className="meta-time">{t}</span>
                    </div>
                  )}
                  <div className="bubble bubble-them">{m.body}</div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="sr-live" aria-live="polite" aria-atomic="true">
        {announce}
      </div>

      <div className="composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={`Message ${groupName}`}
          maxLength={2000}
          aria-label="Message"
        />
        <button
          className="send"
          onClick={submit}
          disabled={!draft.trim() || sending}
          aria-label="Send"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 12 20 4l-4 16-4-7-8-1Z"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {rosterOpen && (
        <div className="sheet-backdrop" onClick={() => setRosterOpen(false)}>
          <div
            ref={sheetRef}
            tabIndex={-1}
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={CHANNEL_LABEL[channelType]}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grabber" aria-hidden />
            <div className="sheet-kicker">{CHANNEL_LABEL[channelType]}</div>
            <h2 className="sheet-title">{groupName}</h2>
            <div className="roster">
              {members.map((m) => (
                <div key={m.userId} className="roster-row">
                  <Avatar name={m.name} url={m.photo_url} size={40} />
                  <span className="roster-name">
                    {m.userId === currentUserId ? "You" : m.name}
                  </span>
                </div>
              ))}
            </div>
            {meetLine && (
              <div className="sheet-plan">
                <span className="plan-kicker">Plan</span>
                <span className="plan-line">{meetLine}</span>
              </div>
            )}
            {/* Both channel types get a way out of the thread, they just lead
                somewhere different. A table has a reveal screen of its own; a
                ride's details live on the Rides segment of 매칭, so send it
                there with the segment already selected rather than to
                /groups/<poolId>, which is not a group and would 404. */}
            <Link
              href={CHANNEL_EXIT[channelType].href(groupId)}
              className="sheet-link"
              onClick={() => setRosterOpen(false)}
            >
              {CHANNEL_EXIT[channelType].label}
            </Link>
            <button className="sheet-close" onClick={() => setRosterOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      <style>{`
        /* Standalone route (no TabBar/.app-main), so this needs its own
           width cap, otherwise messages/composer stretch edge-to-edge on a
           wide screen while every other page is capped at 720px. */
        .chat-root { display: flex; flex-direction: column; height: 100dvh; max-width: 720px; margin: 0 auto; }

        .sr-live {
          position: absolute; width: 1px; height: 1px;
          padding: 0; margin: -1px; overflow: hidden;
          clip: rect(0 0 0 0); clip-path: inset(50%);
          white-space: nowrap; border: 0;
        }

        .chat-head {
          display: flex; align-items: center; gap: 4px; flex-shrink: 0;
          padding: calc(8px + env(safe-area-inset-top)) 8px 8px;
          border-bottom: 1px solid var(--line);
          background: var(--bg);
        }
        .hit {
          flex-shrink: 0; width: 44px; height: 44px;
          display: grid; place-items: center;
          border: none; background: none; cursor: pointer;
          color: var(--ink-2); border-radius: 12px;
        }
        .hit:active { background: var(--surface); }
        .head-id {
          flex: 1; min-width: 0;
          display: flex; align-items: center; gap: 10px;
          border: none; background: none; cursor: pointer;
          padding: 4px 8px; border-radius: 12px; text-align: left;
          color: var(--ink);
        }
        .head-id:active { background: var(--surface); }
        .stack { display: inline-flex; flex-shrink: 0; }
        /* Initials sit in about 0.24 of the avatar's width of side padding, so
           at 26px the glyph has 6.2px of clearance and the 2px ring spends 2 of
           it. An overlap of 9px painted 4.8px over the neighbour's letters, and
           every avatar but the last read as a typo: AC came out as "A(". The
           overlap is now inside the clearance, so the stack still reads as a
           group and no letter is cut. */
        .stack-av { display: inline-flex; margin-left: -4px; }
        .stack-av:first-child { margin-left: 0; }
        .stack-av > span { box-shadow: 0 0 0 2px var(--bg); }
        .head-text { min-width: 0; display: flex; flex-direction: column; }
        .head-title {
          font-family: var(--font-display), sans-serif;
          font-size: 16px; font-weight: 700; letter-spacing: -0.01em;
          line-height: 1.15;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .head-sub {
          font-size: 12px; color: var(--ink-3); margin-top: 1px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .head-caret { flex-shrink: 0; color: var(--ink-3); }

        .chat-scroll {
          flex: 1; overflow-y: auto; padding: 16px;
          display: flex; flex-direction: column;
          -webkit-overflow-scrolling: touch;
        }

        .row { display: flex; }
        .row.mine { flex-direction: column; align-items: flex-end; }
        .row.them { gap: 8px; align-items: flex-start; }
        .av-spacer { flex-shrink: 0; width: 32px; }
        .them-col { min-width: 0; max-width: 78%; display: flex; flex-direction: column; }

        .meta { display: flex; align-items: baseline; gap: 7px; margin: 0 0 3px 2px; }
        .meta-r { justify-content: flex-end; margin: 0 2px 3px 0; }
        .meta-name {
          font-family: var(--font-display), sans-serif;
          font-size: 13px; font-weight: 700; color: var(--ink);
          letter-spacing: -0.01em;
        }
        .meta-time { font-size: 11px; color: var(--ink-3); }
        .meta-r.meta { font-size: 11px; color: var(--ink-3); }

        .bubble {
          max-width: 100%;
          padding: 9px 13px; border-radius: 16px;
          font-size: 15px; line-height: 1.38;
          white-space: pre-wrap; word-break: break-word;
        }
        /* Both neutral — persimmon stays reserved for actions/state. "Me vs them"
           reads from side, alignment and tail direction; mine sits one step
           lighter (--line) so it still feels like the near/active voice. */
        .bubble-them { background: var(--surface); color: var(--ink); border-bottom-left-radius: 5px; }
        .bubble-mine { background: var(--line); color: var(--ink); border-bottom-right-radius: 5px; }

        .status { font-size: 11px; color: var(--ink-3); margin: 3px 4px 0 0; }
        .retry {
          margin-top: 4px; min-height: 44px; padding: 0 16px;
          display: inline-flex; align-items: center;
          font-size: 13px; font-weight: 600;
          color: var(--danger); background: none;
          border: 1px solid var(--danger); border-radius: 999px;
          cursor: pointer;
        }

        /* Loading skeleton */
        .skeleton { display: flex; flex-direction: column; gap: 10px; padding-top: 4px; }
        .sk-row { display: flex; }
        .sk-mine { justify-content: flex-end; }
        .sk-bubble { height: 38px; border-radius: 16px; display: block; }
        .shimmer {
          background: linear-gradient(90deg, var(--surface) 0%, var(--line) 50%, var(--surface) 100%);
          background-size: 200% 100%;
          animation: shimmer 1.3s ease-in-out infinite;
        }
        @keyframes shimmer {
          from { background-position: 200% 0; }
          to { background-position: -200% 0; }
        }

        /* Empty / arrival state */
        .empty { margin: auto; text-align: center; padding: 24px 8px; max-width: 340px; }
        .empty-cluster { display: inline-flex; margin-bottom: 18px; }
        .empty-av > span { box-shadow: 0 0 0 3px var(--bg); }
        .empty-title {
          font-family: var(--font-display), sans-serif;
          font-size: 26px; font-weight: 800; letter-spacing: -0.03em; margin: 0;
        }
        .empty-sub { font-size: 15px; line-height: 1.5; color: var(--ink-2); margin: 8px 0 0; }
        .empty-plan {
          display: inline-flex; flex-direction: column; gap: 2px;
          margin-top: 20px; padding-top: 16px;
          border-top: 1px solid var(--line);
        }
        .empty-plan--starter {
          border-top: none;
          margin-top: 14px;
          padding: 12px 14px;
          border-radius: 12px;
          background: color-mix(in srgb, var(--accent) 8%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
          max-width: 320px;
        }
        .empty-plan--starter .plan-kicker { color: var(--accent); }
        .empty-plan--starter .plan-line {
          font-family: inherit; font-size: 14px; font-weight: 500;
          line-height: 1.4; color: var(--ink);
        }
        .sheet-plan { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 2px; }
        .plan-kicker {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.08em; color: var(--ink-3);
        }
        .plan-line { font-family: var(--font-display), sans-serif; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }

        /* Composer */
        .composer {
          flex-shrink: 0; display: flex; align-items: center; gap: 8px;
          padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
          border-top: 1px solid var(--line); background: var(--bg);
        }
        .composer input {
          flex: 1; padding: 11px 15px;
          border: 1px solid var(--line); border-radius: 22px;
          font-size: 16px; outline: none; /* 16px: below this iOS zooms on focus */
          background: var(--surface); color: var(--ink);
        }
        .composer input:focus { border-color: var(--accent); }
        .send {
          flex-shrink: 0; width: 44px; height: 44px;
          display: grid; place-items: center;
          border: none; border-radius: 50%;
          color: var(--accent-ink); background: var(--accent-grad);
          cursor: pointer; transition: opacity 150ms ease-out, transform 150ms ease-out;
        }
        .send:disabled { opacity: 0.35; cursor: default; }
        .send:not(:disabled):active { transform: scale(0.92); }

        /* Roster sheet — same language as JoinSheet */
        .sheet-backdrop {
          position: fixed; inset: 0; z-index: 100;
          background: var(--overlay); display: flex; align-items: flex-end;
          animation: sheet-fade 200ms ease-out;
        }
        .sheet {
          width: 100%; max-height: 80dvh; overflow-y: auto;
          background: var(--bg); border-radius: 16px 16px 0 0;
          padding: 8px 20px calc(20px + env(safe-area-inset-bottom));
          box-shadow: 0 -8px 40px rgba(0,0,0,0.5);
          animation: sheet-up 300ms cubic-bezier(0.16,1,0.3,1);
        }
        .sheet:focus { outline: none; } /* focus scope, not an interactive control */
        .grabber { width: 36px; height: 5px; border-radius: 999px; background: var(--line); margin: 6px auto 14px; }
        .sheet-kicker {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.08em; color: var(--accent);
        }
        .sheet-title {
          font-family: var(--font-display), sans-serif;
          font-size: 24px; font-weight: 800; letter-spacing: -0.03em; margin: 4px 0 8px;
        }
        .roster { border-bottom: 1px solid var(--line); }
        .roster-row {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 0; border-top: 1px solid var(--line);
        }
        .roster-name { font-size: 16px; font-weight: 600; }
        .sheet-link {
          display: inline-block; margin-top: 18px;
          font-size: 15px; font-weight: 700; color: var(--accent);
        }
        .sheet-close {
          width: 100%; margin-top: 10px; border: none; background: transparent;
          color: var(--ink-3); font-size: 15px; padding: 12px; cursor: pointer;
        }

        @keyframes sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes sheet-fade { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .sheet { animation: sheet-fade 200ms ease-out; }
          .shimmer { animation: none; }
          .send { transition: none; }
        }
      `}</style>
    </div>
  );
}
