"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { downscale } from "@/lib/avatar";

type Basics = { name: string; school: string; position: string; birthday: string; photo_url: string };

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return (p[0]?.[0] ?? "") + (p[1]?.[0] ?? "");
}

export default function StepBasics({
  userId,
  value,
  onChange,
  onContinue,
  onBack,
  busy,
  error,
}: {
  userId: string;
  value: Basics;
  onChange: (p: Partial<Basics>) => void;
  onContinue: () => void;
  onBack: () => void;
  busy: boolean;
  error: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<"idle" | "uploading" | "error">("idle");

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUpload("uploading");
    try {
      const blob = await downscale(file);
      const supabase = createClient();
      const path = `${userId}/avatar.jpg`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      onChange({ photo_url: `${data.publicUrl}?t=${Date.now()}` });
      setUpload("idle");
    } catch {
      setUpload("error");
    }
  }

  const nameValid = value.name.trim().length > 0;

  return (
    <>
      <span className="ob-kicker">Set up · 2 of 5</span>
      <h1 className="ob-title">Let&apos;s set you up</h1>
      <p className="ob-sub">Takes under a minute.</p>

      <div style={{ display: "flex", justifyContent: "center", margin: "26px 0 4px" }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Add profile photo"
          style={{
            position: "relative",
            width: 104,
            height: 104,
            borderRadius: "50%",
            border: "1px solid var(--line)",
            background: value.photo_url
              ? `center/cover no-repeat url("${value.photo_url}")`
              : "var(--surface)",
            color: "var(--ink-2)",
            fontSize: 30,
            fontWeight: 600,
            cursor: "pointer",
            overflow: "hidden",
          }}
        >
          {!value.photo_url &&
            (initials(value.name) || (
              <span style={{ fontSize: 13, fontWeight: 500 }}>Add photo</span>
            ))}
          {upload === "uploading" && (
            <span
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                background: "rgba(0,0,0,0.6)",
                fontSize: 13,
                color: "var(--ink)",
              }}
            >
              Uploading…
            </span>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleFile}
        />
      </div>
      {upload === "error" && (
        <p style={{ textAlign: "center", fontSize: 14, color: "var(--ink-2)", marginBottom: 4 }}>
          Upload failed.{" "}
          <button type="button" className="ob-textlink" onClick={() => fileRef.current?.click()}>
            Retry
          </button>{" "}
          or skip, we&apos;ll use your initials.
        </p>
      )}

      <label className="ob-label" htmlFor="ob-name" style={{ marginTop: 12 }}>Name</label>
      <input
        id="ob-name"
        className="ob-field"
        value={value.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="이름 / Your name"
      />

      <label className="ob-label" htmlFor="ob-school">School / Company</label>
      <input
        id="ob-school"
        className="ob-field"
        value={value.school}
        onChange={(e) => onChange({ school: e.target.value })}
        placeholder="Enter here"
      />

      <label className="ob-label" htmlFor="ob-position">Position</label>
      <input
        id="ob-position"
        className="ob-field"
        value={value.position}
        onChange={(e) => onChange({ position: e.target.value })}
        placeholder="PhD, Software Engineer, …"
      />

      <label className="ob-label" htmlFor="ob-birthday">
        Birthday <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>· optional</span>
      </label>
      <input
        id="ob-birthday"
        type="date"
        className="ob-field"
        value={value.birthday}
        max={new Date().toISOString().slice(0, 10)}
        onChange={(e) => onChange({ birthday: e.target.value })}
      />

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
          disabled={!nameValid || busy || upload === "uploading"}
        >
          {busy ? "Saving…" : "Continue"}
        </button>
      </div>
    </>
  );
}
