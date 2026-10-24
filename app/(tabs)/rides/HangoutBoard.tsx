"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createHangout, joinHangout, leaveHangout } from "@/app/actions/hangouts";
import { displayName } from "@/lib/displayName";
import { DEFAULT_SEATS, MIN_SEATS, MAX_SEATS, type Hangout } from "@/lib/hangouts";
import KakaoMark from "@/components/KakaoMark";

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "·";
}

export default function HangoutBoard({
  hangouts,
  myPoolIds,
  timezone,
  defaultLocal,
}: {
  hangouts: Hangout[];
  myPoolIds: string[];
  timezone: string;
  defaultLocal: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const mine = new Set(myPoolIds);

  return (
    <section className="hg">
      <div className="hg-head">
        <h2 className="hg-title">Leaving from the hotel</h2>
        {!creating && (
          <button type="button" className="hg-start" onClick={() => setCreating(true)}>
            + Start one
          </button>
        )}
      </div>
      <p className="hg-sub">
        Heading somewhere? Say when you want to be out the door and let people come along.
      </p>

      {creating && (
        <NewHangout
          defaultLocal={defaultLocal}
          onDone={() => {
            setCreating(false);
            router.refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {hangouts.length === 0 && !creating && (
        <p className="hg-empty">Nothing planned yet. Be the one who starts it.</p>
      )}

      {hangouts.map((h) => (
        <HangoutCard key={h.id} hangout={h} joined={mine.has(h.id)} timezone={timezone} />
      ))}

      <HgStyles />
    </section>
  );
}

function HangoutCard({
  hangout,
  joined,
  timezone,
}: {
  hangout: Hangout;
  joined: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const fmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });

  const full = hangout.members.length >= hangout.capacity;
  const seatsLeft = hangout.capacity - hangout.members.length;

  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(res.error ?? "That didn't work.");
      }
    });
  }

  return (
    <div className="hg-card">
      <div className="hg-dest">{hangout.title}</div>
      <div className="hg-when">Leave by {fmt.format(new Date(hangout.leaveAt))}</div>
      <div className="hg-meta">
        {hangout.meetPoint || "Hotel lobby"} · {hangout.members.length} of {hangout.capacity}
        {!full && !joined && ` · ${seatsLeft} spot${seatsLeft === 1 ? "" : "s"} left`}
      </div>

      {hangout.members.map((m) => (
        <div key={m.id} className="hg-member">
          <div
            aria-hidden
            className="hg-avatar"
            style={
              m.photo_url
                ? { background: `center/cover no-repeat url("${m.photo_url}")` }
                : undefined
            }
          >
            {!m.photo_url && initials(m.name)}
          </div>
          <span className="hg-name">{displayName(m.name)}</span>
          {/* Only ever populated for people you already share a channel with,
              because profiles.p_sel decides that server-side. Joining is what
              makes it appear; this component does no gating of its own. */}
          {m.kakao && (
            <span className="hg-kakao">
              <KakaoMark />
              <span className="hg-handle">{m.kakao}</span>
            </span>
          )}
        </div>
      ))}

      <div className="hg-actions">
        {joined ? (
          <>
            <Link href={`/rides/${hangout.id}/chat`} className="hg-chat">
              Open chat
            </Link>
            {!confirming ? (
              <button type="button" className="hg-quiet" onClick={() => setConfirming(true)}>
                Leave
              </button>
            ) : (
              <span className="hg-confirm">
                Drop out?{" "}
                <button
                  type="button"
                  className="hg-confirm-yes"
                  disabled={pending}
                  onClick={() => act(() => leaveHangout(hangout.id))}
                >
                  {pending ? "…" : "Yes"}
                </button>{" "}
                <button type="button" className="hg-quiet" onClick={() => setConfirming(false)}>
                  No
                </button>
              </span>
            )}
          </>
        ) : full ? (
          <span className="hg-full">Full</span>
        ) : (
          <button
            type="button"
            className="hg-chat"
            disabled={pending}
            onClick={() => act(() => joinHangout(hangout.id))}
          >
            {pending ? "…" : "I'm in"}
          </button>
        )}
      </div>

      {error && <p className="hg-error">{error}</p>}
    </div>
  );
}

function NewHangout({
  defaultLocal,
  onDone,
  onCancel,
}: {
  defaultLocal: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(defaultLocal);
  const [seats, setSeats] = useState(DEFAULT_SEATS);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function submit() {
    setError("");
    startTransition(async () => {
      const res = await createHangout({ title, localDateTime: when, seats });
      if (res.ok) onDone();
      else setError(res.error ?? "Couldn't start that.");
    });
  }

  return (
    <div className="hg-card hg-form">
      <label className="hg-label" htmlFor="hg-dest">
        Where to
      </label>
      <input
        id="hg-dest"
        className="hg-input"
        value={title}
        maxLength={80}
        placeholder="Dinner downtown"
        onChange={(e) => setTitle(e.target.value)}
      />

      <label className="hg-label" htmlFor="hg-when">
        Leave hotel by
      </label>
      <input
        id="hg-when"
        className="hg-input"
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
      />

      <label className="hg-label" htmlFor="hg-seats">
        How many can come
      </label>
      <input
        id="hg-seats"
        className="hg-input hg-input--narrow"
        type="number"
        inputMode="numeric"
        min={MIN_SEATS}
        max={MAX_SEATS}
        value={seats}
        onChange={(e) => setSeats(Number(e.target.value))}
      />

      <div className="hg-actions">
        <button type="button" className="hg-chat" disabled={pending} onClick={submit}>
          {pending ? "…" : "Post it"}
        </button>
        <button type="button" className="hg-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {error && <p className="hg-error">{error}</p>}
    </div>
  );
}

function HgStyles() {
  return (
    <style>{`
      .hg { margin-top: 32px; }
      .hg-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .hg-title {
        font-family: var(--font-display), sans-serif;
        font-size: 20px;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .hg-start {
        background: none;
        border: none;
        padding: 0;
        font-size: 14px;
        font-weight: 700;
        color: var(--accent);
        cursor: pointer;
      }
      .hg-sub { margin-top: 6px; font-size: 14px; color: var(--ink-2); max-width: 38ch; }
      .hg-empty { margin-top: 14px; font-size: 14px; color: var(--ink-3); }
      .hg-card {
        margin-top: 12px;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 14px;
      }
      .hg-dest {
        font-family: var(--font-display), sans-serif;
        font-size: 18px;
        font-weight: 800;
        letter-spacing: -0.02em;
        overflow-wrap: anywhere;
      }
      .hg-when { margin-top: 4px; font-size: 15px; font-weight: 600; color: var(--ink); }
      .hg-meta { margin-top: 4px; font-size: 13px; color: var(--ink-2); }
      .hg-member {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 0;
        border-top: 1px solid var(--line);
        margin-top: 8px;
        font-size: 14px;
      }
      .hg-avatar {
        flex-shrink: 0;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 1px solid var(--line);
        background: var(--surface);
        color: var(--ink-2);
        display: grid;
        place-items: center;
        font-size: 12px;
        font-weight: 600;
        overflow: hidden;
      }
      .hg-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .hg-kakao { margin-left: auto; display: flex; align-items: center; gap: 6px; min-width: 0; }
      .hg-handle {
        font-size: 13px;
        font-weight: 600;
        color: var(--ink-2);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .hg-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 14px;
      }
      .hg-chat {
        min-height: 32px;
        padding: 6px 14px;
        border-radius: 999px;
        border: 1px solid var(--accent);
        background: none;
        color: var(--accent);
        font-size: 13px;
        font-weight: 700;
        text-decoration: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
      }
      .hg-chat:disabled { opacity: 0.6; cursor: default; }
      .hg-quiet {
        background: none;
        border: none;
        color: var(--ink-3);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .hg-full {
        display: inline-flex;
        align-items: center;
        min-height: 32px;
        font-size: 13px;
        font-weight: 600;
        color: var(--ink-3);
      }
      .hg-confirm { font-size: 13px; color: var(--ink-2); }
      .hg-confirm-yes { background: none; border: none; color: var(--danger); font-weight: 700; cursor: pointer; }
      .hg-form .hg-label {
        display: block;
        margin-top: 12px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ink-3);
      }
      .hg-form .hg-label:first-child { margin-top: 0; }
      .hg-input {
        width: 100%;
        margin-top: 6px;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--bg);
        color: var(--ink);
        font: inherit;
        font-size: 15px;
      }
      .hg-input--narrow { width: 6em; }
      .hg-error { font-size: 13px; color: var(--danger); margin-top: 8px; }
    `}</style>
  );
}
