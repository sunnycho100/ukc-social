"use client";

type Contact = { bio: string; kakao: string; linkedin: string };

export default function StepContact({
  value,
  onChange,
  onContinue,
  onBack,
  busy,
  error,
}: {
  value: Contact;
  onChange: (p: Partial<Contact>) => void;
  onContinue: () => void;
  onBack: () => void;
  busy: boolean;
  error: string;
}) {
  const hasContact = !!(value.kakao.trim() || value.linkedin.trim());

  return (
    <>
      <span className="ob-kicker">Set up · 4 of 5</span>
      <h1 className="ob-title">How can people reach you?</h1>
      <p className="ob-sub">Shown only after you share a table or ride — never public.</p>

      <label className="ob-label" htmlFor="ob-bio">One-line bio</label>
      <input
        id="ob-bio"
        className="ob-field"
        value={value.bio}
        onChange={(e) => onChange({ bio: e.target.value })}
        placeholder="Third-year robotics PhD, always down for 국밥."
      />

      <label className="ob-label" htmlFor="ob-kakao">KakaoTalk ID</label>
      <input
        id="ob-kakao"
        className="ob-field"
        value={value.kakao}
        onChange={(e) => onChange({ kakao: e.target.value })}
        placeholder="Optional"
      />

      <label className="ob-label" htmlFor="ob-linkedin">
        LinkedIn <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>· optional</span>
      </label>
      <input
        id="ob-linkedin"
        className="ob-field"
        value={value.linkedin}
        onChange={(e) => onChange({ linkedin: e.target.value })}
        placeholder="linkedin.com/in/…"
      />

      {!hasContact && (
        <div className="ct-nudge">
          Add at least one — otherwise your tablemates see &quot;no contacts yet&quot; the
          moment you&apos;re matched.
        </div>
      )}

      {error && (
        <p style={{ color: "var(--danger)", fontSize: 14, marginTop: 16 }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 28 }}>
        <button type="button" className="ob-back" onClick={onBack}>
          Back
        </button>
        <button type="button" className="ob-primary" onClick={onContinue} disabled={busy}>
          {busy ? "Saving…" : "Continue"}
        </button>
      </div>

      <style>{`
        .ct-nudge {
          margin-top: 18px; padding: 12px 14px; border-radius: 12px;
          background: color-mix(in srgb, var(--accent) 8%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
          color: var(--ink-2); font-size: 12px; line-height: 1.5;
        }
      `}</style>
    </>
  );
}
