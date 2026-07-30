"use client";

import { useState, useTransition } from "react";
import { upsertConference } from "@/app/actions/conference";
import { toLocalInput } from "@/lib/rides";
import type { Conference } from "@/lib/conference";

const DAY_MS = 86_400_000;

function toIso(localDateTime: string, utcOffset: string): string {
  return new Date(`${localDateTime}:00${utcOffset}`).toISOString();
}

export default function AdminConferenceForm({ conference }: { conference: Conference | null }) {
  const tz = conference?.timezone ?? "America/New_York";
  const [form, setForm] = useState({
    name: conference?.name ?? "",
    location: conference?.location ?? "",
    starts_at: conference ? toLocalInput(conference.starts_at, tz) : "",
    ends_at: conference ? toLocalInput(conference.ends_at, tz) : "",
    timezone: conference?.timezone ?? "America/New_York",
    utc_offset: conference?.utc_offset ?? "-04:00",
    airport_code: conference?.airport_code ?? "",
    auto_matching_enabled: conference?.auto_matching_enabled ?? false,
    matching_interval_minutes: conference?.matching_interval_minutes ?? 360,
  });
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function patch(p: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...p }));
  }

  function submit() {
    setResult(null);
    startTransition(async () => {
      const r = await upsertConference({
        id: conference?.id,
        name: form.name.trim(),
        location: form.location.trim(),
        starts_at: toIso(form.starts_at, form.utc_offset),
        ends_at: toIso(form.ends_at, form.utc_offset),
        timezone: form.timezone.trim(),
        utc_offset: form.utc_offset.trim(),
        airport_code: form.airport_code.trim(),
        auto_matching_enabled: form.auto_matching_enabled,
        matching_interval_minutes: Number(form.matching_interval_minutes),
      });
      setResult(r.ok ? "Saved." : `error: ${r.error}`);
    });
  }

  const autoMatchStarts = conference
    ? new Date(new Date(conference.starts_at).getTime() - 7 * DAY_MS)
    : null;

  return (
    <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 20, marginBottom: 20 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
        {conference ? "Conference" : "Register your conference"}
      </h2>
      <p style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 14 }}>
        {conference
          ? "Update details, or turn on periodic auto-matching."
          : "Fill this in once per fork/deployment — it drives copy, timing, and matching."}
      </p>

      <Field label="Name">
        <input
          className="admin-input"
          value={form.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="e.g. UKC 2026"
        />
      </Field>
      <Field label="Location">
        <input
          className="admin-input"
          value={form.location}
          onChange={(e) => patch({ location: e.target.value })}
          placeholder="e.g. ChampionsGate, FL"
        />
      </Field>
      <div style={{ display: "flex", gap: 12 }}>
        <Field label="Starts">
          <input
            type="datetime-local"
            className="admin-input"
            value={form.starts_at}
            onChange={(e) => patch({ starts_at: e.target.value })}
          />
        </Field>
        <Field label="Ends">
          <input
            type="datetime-local"
            className="admin-input"
            value={form.ends_at}
            onChange={(e) => patch({ ends_at: e.target.value })}
          />
        </Field>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <Field label="Timezone (IANA)">
          <input
            className="admin-input"
            value={form.timezone}
            onChange={(e) => patch({ timezone: e.target.value })}
            placeholder="America/New_York"
          />
        </Field>
        <Field label="UTC offset">
          <input
            className="admin-input"
            value={form.utc_offset}
            onChange={(e) => patch({ utc_offset: e.target.value })}
            placeholder="-04:00"
          />
        </Field>
        <Field label="Airport code">
          <input
            className="admin-input"
            value={form.airport_code}
            onChange={(e) => patch({ airport_code: e.target.value.toUpperCase() })}
            placeholder="MCO"
          />
        </Field>
      </div>

      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8 }}>
        <input
          id="auto-matching"
          type="checkbox"
          checked={form.auto_matching_enabled}
          onChange={(e) => patch({ auto_matching_enabled: e.target.checked })}
        />
        <label htmlFor="auto-matching" style={{ fontSize: 14, fontWeight: 600 }}>
          Auto-match starting 7 days before the conference
        </label>
      </div>
      <Field label="Auto-match every (minutes)">
        <input
          type="number"
          min={15}
          step={15}
          className="admin-input"
          style={{ maxWidth: 140 }}
          value={form.matching_interval_minutes}
          onChange={(e) => patch({ matching_interval_minutes: Number(e.target.value) })}
        />
      </Field>
      <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: -4, marginBottom: 10 }}>
        e.g. 360 = every 6 hours. Enforced inside /api/cron/auto-match — the actual Vercel
        Cron tick may be less frequent depending on plan.
      </p>

      {conference && (
        <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4 }}>
          Auto-matching window opens {autoMatchStarts!.toLocaleString()}. Last run:{" "}
          {conference.last_auto_match_at
            ? new Date(conference.last_auto_match_at).toLocaleString()
            : "never"}
          .
        </p>
      )}

      <button
        onClick={submit}
        disabled={pending || !form.name.trim() || !form.starts_at || !form.ends_at}
        style={{
          marginTop: 14,
          padding: "8px 16px",
          borderRadius: 8,
          border: "none",
          background: pending ? "var(--ink-3)" : "var(--accent-grad)",
          color: "var(--accent-ink)",
          fontWeight: 600,
          fontSize: 14,
          cursor: pending ? "default" : "pointer",
        }}
      >
        {pending ? "Saving…" : conference ? "Save changes" : "Register conference"}
      </button>
      {result && (
        <span style={{ marginLeft: 12, fontSize: 13, color: "var(--ink-2)" }}>{result}</span>
      )}

      <style>{`
        .admin-input {
          width: 100%;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--line);
          background: transparent;
          color: var(--ink);
          font-size: 14px;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, marginTop: 10 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink-2)", marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}
