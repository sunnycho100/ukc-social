"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Notification = {
  id: string;
  type: "table_revealed" | "ride_matched" | "hi_received";
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

const COPY: Record<Notification["type"], { text: string; href: (p: Record<string, unknown>) => string }> = {
  table_revealed: { text: "Your table is set — say hi.", href: (p) => `/groups/${p.group_id}/chat` },
  ride_matched: { text: "Someone joined your ride.", href: () => "/rides" },
  hi_received: { text: "Someone said hi to you.", href: () => "/home" },
};

export default function NotificationBell() {
  const supabase = useRef(createClient()).current;
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const unread = items.filter((n) => !n.read_at).length;

  useEffect(() => {
    let active = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !active) return;

      const { data } = await supabase
        .from("notifications")
        .select("id, type, payload, read_at, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (active) setItems((data as Notification[]) ?? []);

      const channel = supabase
        .channel(`notif-${user.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
          (payload) => {
            const n = payload.new as Notification;
            setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]));
          },
        )
        .subscribe();
      return () => {
        supabase.removeChannel(channel);
      };
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markAllRead() {
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
        className="notif-bell"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4.5a5 5 0 0 0-5 5v3.2c0 .6-.2 1.2-.6 1.7L5 16h14l-1.4-1.6a2.7 2.7 0 0 1-.6-1.7V9.5a5 5 0 0 0-5-5Z" />
          <path d="M10 18.5a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && <span className="notif-dot" aria-hidden />}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-panel__head">
            <span>Notifications</span>
            {unread > 0 && (
              <button type="button" className="notif-markread" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="notif-empty">Nothing yet.</p>
          ) : (
            items.map((n) => (
              <Link
                key={n.id}
                href={COPY[n.type].href(n.payload)}
                className="notif-row"
                onClick={() => setOpen(false)}
                style={{ opacity: n.read_at ? 0.6 : 1 }}
              >
                {COPY[n.type].text}
              </Link>
            ))
          )}
        </div>
      )}

      <style>{`
        .notif-bell {
          position: relative;
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          border: none;
          background: none;
          color: var(--ink-2);
          cursor: pointer;
        }
        .notif-dot {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--danger, #e8788a);
        }
        .notif-panel {
          position: absolute;
          top: 46px;
          right: 0;
          width: 280px;
          max-height: 340px;
          overflow-y: auto;
          background: var(--surface, #101B27);
          border: 1px solid var(--line);
          border-radius: 14px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.4);
          z-index: 60;
          padding: 6px 0;
        }
        .notif-panel__head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 700;
          color: var(--ink);
        }
        .notif-markread {
          background: none;
          border: none;
          color: var(--accent);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .notif-empty {
          padding: 16px 14px;
          font-size: 13px;
          color: var(--ink-3);
        }
        .notif-row {
          display: block;
          padding: 10px 14px;
          font-size: 13px;
          color: var(--ink);
          text-decoration: none;
          border-top: 1px solid var(--line);
        }
        .notif-row:first-of-type { border-top: none; }
      `}</style>
    </div>
  );
}
