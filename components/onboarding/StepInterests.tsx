"use client";

import { useState } from "react";

// Ordered broad → specific → social, so the first chips are easy general buckets
// and the niche ones sit lower for people who want them.
const SEED = [
  // Broad fields
  "AI / ML", "Robotics", "Biology / Health", "Engineering", "Physics / Materials",
  "Data / Quant", "Software", "Design / HCI", "Startups",
  // More specific
  "Computer Vision", "NLP / Agents", "RL", "Perception", "Bioengineering",
  "Neuroscience", "Semiconductors", "Energy",
  // For fun
  "국밥 crew", "Coffee chat", "Night owl", "K-drama", "Golf", "Runners",
];

export default function StepInterests({
  value,
  onChange,
  onContinue,
  onBack,
  busy,
  error,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  onContinue: () => void;
  onBack: () => void;
  busy: boolean;
  error: string;
}) {
  const [custom, setCustom] = useState("");
  const options = [...SEED, ...value.filter((v) => !SEED.includes(v))];

  const toggle = (chip: string) =>
    onChange(value.includes(chip) ? value.filter((v) => v !== chip) : [...value, chip]);

  function addCustom() {
    const t = custom.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setCustom("");
  }

  const enough = value.length >= 3;

  return (
    <>
      <span className="ob-kicker">Set up · 3 of 5</span>
      <h1 className="ob-title">What are you into?</h1>
      <p className="ob-sub">
        Pick a few. We&apos;ll use these to seat you.{" "}
        <span style={{ color: enough ? "var(--ink-2)" : "var(--accent)", fontWeight: 600 }}>
          {enough ? `${value.length} selected` : "3+ to continue"}
        </span>
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
        {options.map((chip) => {
          const on = value.includes(chip);
          return (
            <button
              key={chip}
              type="button"
              className={on ? "ob-chip on" : "ob-chip"}
              onClick={() => toggle(chip)}
              aria-pressed={on}
            >
              {chip}
            </button>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          addCustom();
        }}
        style={{ marginTop: 18 }}
      >
        <label className="ob-label" htmlFor="ob-custom" style={{ marginTop: 0 }}>
          Add your own
        </label>
        <input
          id="ob-custom"
          className="ob-field"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Type and press Enter"
        />
      </form>

      {error && (
        <p style={{ color: "var(--danger)", fontSize: 14, marginTop: 16 }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
        <button type="button" className="ob-back" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="ob-primary"
          onClick={onContinue}
          disabled={!enough || busy}
        >
          {busy ? "Saving…" : "Continue"}
        </button>
      </div>
    </>
  );
}
