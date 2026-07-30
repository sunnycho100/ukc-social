"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { downscale } from "@/lib/avatar";
import { saveProfile } from "@/app/actions/profile";
import { submitFlight, deleteFlight } from "@/app/actions/flights";

type Profile = {
  name: string;
  school: string;
  position: string;
  interests: string[];
  bio: string;
  kakao: string;
  linkedin: string;
  dietary: string;
  photo_url: string | null;
};

type Flight = { arrival: string; departure: string };

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "·";
}

// Flight values are bare "YYYY-MM-DDTHH:mm" (no offset) — already the
// conference-local wall clock (see toLocalInput), so a plain locale format
// reads them back correctly without re-applying a timezone.
function fmtFlight(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="ob-label">{children}</label>;
}

export default function ProfileEditor({
  userId,
  initial,
  initialFlight,
  flightDefaults,
}: {
  userId: string;
  initial: Profile;
  initialFlight: Flight;
  flightDefaults: Flight;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Profile>(initial);
  const [flight, setFlight] = useState<Flight>({
    arrival: initialFlight.arrival || flightDefaults.arrival,
    departure: initialFlight.departure || flightDefaults.departure,
  });
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<"idle" | "uploading" | "error">("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState("");

  const set = (p: Partial<Profile>) => setForm((f) => ({ ...f, ...p }));
  const setF = (p: Partial<Flight>) => setFlight((f) => ({ ...f, ...p }));

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

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
      set({ photo_url: `${data.publicUrl}?t=${Date.now()}` });
      setUpload("idle");
    } catch {
      setUpload("error");
    }
  }

  function addCustom() {
    const t = custom.trim();
    if (t && !form.interests.includes(t)) set({ interests: [...form.interests, t] });
    setCustom("");
  }

  async function save() {
    if (!form.name.trim()) {
      setError("Name can't be empty.");
      return;
    }
    setError("");
    setBusy(true);
    const [profileRes, arrivalRes, departureRes] = await Promise.all([
      saveProfile({
        name: form.name.trim(),
        school: form.school,
        position: form.position,
        interests: form.interests,
        bio: form.bio,
        kakao: form.kakao,
        linkedin: form.linkedin,
        dietary: form.dietary,
        photo_url: form.photo_url ?? undefined,
      }),
      flight.arrival
        ? submitFlight({ direction: "arrival", localDateTime: flight.arrival })
        : initialFlight.arrival
          ? deleteFlight("arrival")
          : Promise.resolve({ ok: true as const, error: undefined as string | undefined }),
      flight.departure
        ? submitFlight({ direction: "departure", localDateTime: flight.departure })
        : initialFlight.departure
          ? deleteFlight("departure")
          : Promise.resolve({ ok: true as const, error: undefined as string | undefined }),
    ]);
    setBusy(false);
    if (profileRes.ok && arrivalRes.ok && departureRes.ok) {
      setEditing(false);
      flash("Saved");
      router.refresh();
    } else {
      setError(profileRes.error ?? arrivalRes.error ?? departureRes.error ?? "Couldn't save. Try again.");
    }
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (!editing) {
    return (
      <div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div
            aria-hidden
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              border: "1px solid var(--line)",
              background: form.photo_url
                ? `center/cover no-repeat url("${form.photo_url}")`
                : "var(--surface)",
              color: "var(--ink-2)",
              display: "grid",
              placeItems: "center",
              fontSize: 26,
              fontWeight: 600,
              overflow: "hidden",
            }}
          >
            {!form.photo_url && initials(form.name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>
              {form.name || "You"}
            </div>
            <div style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 2 }}>
              {[form.school, form.position].filter(Boolean).join(" · ") || "Not set"}
            </div>
          </div>
        </div>

        {form.interests.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
            {form.interests.map((i) => (
              <span key={i} className="pe-tag">
                {i}
              </span>
            ))}
          </div>
        )}
        {form.bio && (
          <p style={{ fontSize: 15, color: "var(--ink)", marginTop: 14, lineHeight: 1.5 }}>
            {form.bio}
          </p>
        )}

        {(fmtFlight(flight.arrival) || fmtFlight(flight.departure)) && (
          <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 14 }}>
            ✈ {fmtFlight(flight.arrival) ? `Landing ${fmtFlight(flight.arrival)}` : "No arrival set"}
            {" · "}
            {fmtFlight(flight.departure) ? `Leaving ${fmtFlight(flight.departure)}` : "No departure set"}
          </p>
        )}

        <button type="button" onClick={() => setEditing(true)} className="pe-edit-btn">
          Edit profile
        </button>
        <button type="button" onClick={signOut} className="pe-signout">
          Sign out
        </button>

        {toast && (
          <div className="pe-toast" role="status">
            {toast}
          </div>
        )}
        <PeStyles />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 4px" }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Change profile photo"
          style={{
            position: "relative",
            width: 96,
            height: 96,
            borderRadius: "50%",
            border: "1px solid var(--line)",
            background: form.photo_url
              ? `center/cover no-repeat url("${form.photo_url}")`
              : "var(--surface)",
            color: "var(--ink-2)",
            fontSize: 26,
            fontWeight: 600,
            cursor: "pointer",
            overflow: "hidden",
          }}
        >
          {!form.photo_url && initials(form.name)}
          {upload === "uploading" && (
            <span
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                background: "rgba(0,0,0,0.6)",
                fontSize: 12,
                color: "var(--ink)",
              }}
            >
              Uploading…
            </span>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
      </div>
      {upload === "error" && (
        <p style={{ textAlign: "center", fontSize: 13, color: "var(--danger)", marginBottom: 8 }}>
          Upload failed.{" "}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            style={{ color: "var(--accent)", fontWeight: 600 }}
          >
            retry
          </button>
        </p>
      )}

      <Label>Name</Label>
      <input className="ob-field" value={form.name} onChange={(e) => set({ name: e.target.value })} />
      <Label>School / Company</Label>
      <input className="ob-field" value={form.school} onChange={(e) => set({ school: e.target.value })} />
      <Label>Position</Label>
      <input className="ob-field" value={form.position} onChange={(e) => set({ position: e.target.value })} />

      <Label>Interests</Label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {form.interests.map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => set({ interests: form.interests.filter((x) => x !== i) })}
            className="pe-chip-on"
            aria-label={`Remove ${i}`}
          >
            {i} ✕
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addCustom();
        }}
      >
        <input
          className="ob-field"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Add an interest, press Enter"
        />
      </form>

      <Label>Bio</Label>
      <textarea
        className="ob-field"
        style={{ resize: "none", minHeight: 72 }}
        value={form.bio}
        onChange={(e) => set({ bio: e.target.value })}
        placeholder="One line about you"
      />
      <Label>KakaoTalk ID</Label>
      <input className="ob-field" value={form.kakao} onChange={(e) => set({ kakao: e.target.value })} />
      <Label>LinkedIn</Label>
      <input className="ob-field" value={form.linkedin} onChange={(e) => set({ linkedin: e.target.value })} />
      <Label>Dietary notes</Label>
      <input
        className="ob-field"
        value={form.dietary}
        onChange={(e) => set({ dietary: e.target.value })}
        placeholder="Vegetarian, halal, allergies…"
      />

      <Label>Flights</Label>
      <p style={{ fontSize: 12, color: "var(--ink-2)", marginTop: -2, marginBottom: 4 }}>
        Just the time — matched with others flying near the same window on{" "}
        <a href="/rides" style={{ color: "var(--accent)", fontWeight: 600 }}>
          Rides
        </a>
        .
      </p>
      <label className="ob-label" htmlFor="pe-arrival" style={{ marginTop: 8 }}>
        Landing
      </label>
      <input
        id="pe-arrival"
        type="datetime-local"
        className="ob-field"
        value={flight.arrival}
        onChange={(e) => setF({ arrival: e.target.value })}
      />
      <label className="ob-label" htmlFor="pe-departure">
        Leaving
      </label>
      <input
        id="pe-departure"
        type="datetime-local"
        className="ob-field"
        value={flight.departure}
        onChange={(e) => setF({ departure: e.target.value })}
      />

      {error && <p style={{ color: "var(--danger)", fontSize: 14, marginTop: 16 }}>{error}</p>}

      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <button
          type="button"
          onClick={() => {
            setForm(initial);
            setFlight({
              arrival: initialFlight.arrival || flightDefaults.arrival,
              departure: initialFlight.departure || flightDefaults.departure,
            });
            setEditing(false);
            setError("");
          }}
          className="pe-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy || upload === "uploading"}
          className="pe-save"
          style={{ opacity: busy || upload === "uploading" ? 0.5 : 1 }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {toast && (
        <div className="pe-toast" role="status">
          {toast}
        </div>
      )}
      <PeStyles />
    </div>
  );
}

function PeStyles() {
  return (
    <style>{`
      .pe-tag {
        font-size: 13px;
        font-weight: 500;
        padding: 6px 12px;
        border-radius: 999px;
        background: var(--surface);
        color: var(--ink);
        border: 1px solid var(--line);
      }
      .pe-chip-on {
        padding: 8px 14px;
        border-radius: 999px;
        font-size: 14px;
        font-weight: 500;
        border: 1px solid var(--accent);
        background: var(--accent);
        color: var(--accent-ink);
        cursor: pointer;
      }
      .pe-edit-btn {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        margin-top: 20px;
        padding: 0 2px;
        font-size: 15px;
        font-weight: 700;
        border: none;
        color: var(--accent);
        background: none;
        cursor: pointer;
      }
      .pe-edit-btn::after { content: " ▸"; }
      .pe-signout {
        display: block;
        width: 100%;
        margin-top: 12px;
        padding: 13px;
        border-radius: 12px;
        font-size: 15px;
        font-weight: 600;
        color: var(--ink-2);
        background: none;
      }
      .pe-cancel {
        padding: 14px 20px;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 600;
        border: 1px solid var(--line);
        color: var(--ink);
        background: var(--bg);
      }
      .pe-save {
        flex: 1;
        padding: 14px;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 700;
        background: var(--accent-grad);
        color: var(--accent-ink);
        border: none;
        transition: opacity 180ms ease-out;
      }
      .pe-toast {
        position: fixed;
        left: 50%;
        bottom: calc(96px + env(safe-area-inset-bottom));
        transform: translateX(-50%);
        z-index: 60;
        background: var(--ink);
        color: var(--bg);
        font-size: 14px;
        padding: 10px 16px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        animation: pe-toast-in 200ms ease-out;
      }
      @keyframes pe-toast-in {
        from { opacity: 0; transform: translate(-50%, 8px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .pe-save { transition: none; }
        .pe-toast { animation: none; }
      }
    `}</style>
  );
}
