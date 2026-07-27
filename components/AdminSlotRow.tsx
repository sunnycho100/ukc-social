"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runMatching } from "@/app/actions/admin";

export default function AdminSlotRow({
  slotId,
  title,
  count,
  groupCount,
}: {
  slotId: string;
  title: string;
  count: number;
  groupCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ text: string; failed: boolean } | null>(null);
  // Re-running destroys live table assignments and orphans their group chats, so
  // it takes a second deliberate tap. A first run has nothing to lose and fires.
  const [armed, setArmed] = useState(false);
  const destructive = groupCount > 0;

  function run() {
    if (destructive && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setResult(null);
    startTransition(async () => {
      const r = await runMatching(slotId);
      if (!r.ok) {
        setResult({ text: r.error ?? "Something went wrong.", failed: true });
        return;
      }
      const bits = [
        `${r.groups} group${r.groups === 1 ? "" : "s"}`,
        r.strategy === "fallback" ? "round robin fallback" : "interest matched",
      ];
      if (r.flex) bits.push("one small table");
      setResult({ text: r.note ?? bits.join(" · "), failed: false });
      router.refresh();
    });
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "14px 0",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
          {count} signup{count === 1 ? "" : "s"}
          {destructive && (
            <span style={{ color: "var(--ink-2)" }}>
              {" "}
              · {groupCount} group{groupCount === 1 ? "" : "s"} live
            </span>
          )}
        </div>
        <div
          role={result?.failed ? "alert" : "status"}
          style={{
            fontSize: 13,
            marginTop: result ? 3 : 0,
            color: result?.failed ? "var(--accent)" : "var(--ink-2)",
          }}
        >
          {result?.text ?? ""}
        </div>
      </div>
      <button
        onClick={run}
        onBlur={() => setArmed(false)}
        disabled={pending}
        aria-busy={pending}
        data-slot-id={slotId}
        style={{
          flexShrink: 0,
          minHeight: 44,
          padding: "0 14px",
          borderRadius: 8,
          border: "none",
          background: "var(--accent)",
          color: "var(--accent-ink)",
          fontWeight: 600,
          fontSize: 14,
          opacity: pending ? 0.45 : 1,
          cursor: pending ? "default" : "pointer",
        }}
      >
        {pending
          ? "Running…"
          : armed
            ? `Replace ${groupCount} group${groupCount === 1 ? "" : "s"}?`
            : destructive
              ? "Re-run"
              : "Run matching"}
      </button>
    </div>
  );
}
