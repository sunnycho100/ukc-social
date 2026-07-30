"use client";

import { useState, useTransition } from "react";
import { runMatching } from "@/app/actions/admin";

export default function AdminSlotRow({
  slotId,
  title,
  count,
}: {
  slotId: string;
  title: string;
  count: number;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      const r = await runMatching(slotId);
      setResult(
        r.ok
          ? `${r.groups} group${r.groups === 1 ? "" : "s"} · flex: ${r.flex ? "yes" : "no"}` +
              (r.excluded ? ` · ${r.excluded} left unmatched (schedule)` : "")
          : `error: ${r.error}`,
      );
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
          {result && (
            <span style={{ color: "var(--ink-2)" }}> · {result}</span>
          )}
        </div>
      </div>
      <button
        onClick={run}
        disabled={pending}
        data-slot-id={slotId}
        style={{
          flexShrink: 0,
          padding: "8px 14px",
          borderRadius: 8,
          border: "none",
          background: pending ? "var(--ink-3)" : "var(--accent-grad)",
          color: "var(--accent-ink)",
          fontWeight: 600,
          fontSize: 14,
          cursor: pending ? "default" : "pointer",
        }}
      >
        {pending ? "Running…" : "Run matching"}
      </button>
    </div>
  );
}
