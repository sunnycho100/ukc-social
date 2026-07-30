"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { saveProfile, setDinnerSignups } from "@/app/actions/profile";
import { submitFlight } from "@/app/actions/flights";
import type { Conference } from "@/lib/conference";
import StepEvent, { type EventChoice } from "./StepEvent";
import StepBasics from "./StepBasics";
import StepInterests from "./StepInterests";
import StepContact from "./StepContact";
import StepPlans, { type Flight } from "./StepPlans";

const TOTAL_STEPS = 5;

type Data = {
  eventId: EventChoice | "";
  stayStart: string;
  stayEnd: string;
  name: string;
  school: string;
  position: string;
  birthday: string;
  photo_url: string;
  interests: string[];
  bio: string;
  kakao: string;
  linkedin: string;
  slotIds: string[];
  flight: Flight;
};

export default function OnboardingClient({
  userId,
  conference,
}: {
  userId: string;
  conference: Conference | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const step = Math.min(TOTAL_STEPS, Math.max(1, Number(params.get("step")) || 1));

  const EMPTY: Data = {
    eventId: "",
    stayStart: "",
    stayEnd: "",
    name: "",
    school: "",
    position: "",
    birthday: "",
    photo_url: "",
    interests: [],
    bio: "",
    kakao: "",
    linkedin: "",
    slotIds: [],
    flight: { arrival: "", departure: "" },
  };
  // Draft survives a refresh / backgrounded tab (only `step` is in the URL).
  const [data, setData] = useState<Data>(() => {
    if (typeof window === "undefined") return EMPTY;
    try {
      const raw = localStorage.getItem("onboarding-draft");
      return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
    } catch {
      return EMPTY;
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem("onboarding-draft", JSON.stringify(data));
    } catch {
      /* quota / private mode — draft just won't persist */
    }
  }, [data]);

  const patch = (p: Partial<Data>) => setData((d) => ({ ...d, ...p }));
  const goto = (s: number) => router.replace(`/welcome?step=${s}`);

  async function save(fields: Parameters<typeof saveProfile>[0], next: number) {
    setBusy(true);
    setError("");
    const r = await saveProfile(fields);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Could not save");
    goto(next);
  }

  async function finish() {
    setBusy(true);
    setError("");
    const a = await saveProfile({ dinners_wanted: data.slotIds });
    const b = await setDinnerSignups(data.slotIds);
    // Flights are optional — just a time each way, matching is by time
    // window anyway (see lib/rides.ts / Board.tsx). Only submit whichever
    // was actually entered, and don't block finishing onboarding if it
    // fails (same non-fatal pattern as everything else here; editable
    // anytime on Me).
    if (data.flight.arrival) {
      await submitFlight({ direction: "arrival", localDateTime: data.flight.arrival });
    }
    if (data.flight.departure) {
      await submitFlight({ direction: "departure", localDateTime: data.flight.departure });
    }
    setBusy(false);
    if (!a.ok || !b.ok)
      return setError(a.error ?? b.error ?? "Could not finish");
    try {
      localStorage.removeItem("onboarding-draft");
    } catch {
      /* ignore */
    }
    router.push("/home");
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        maxWidth: 430,
        margin: "0 auto",
        padding: "24px 24px 40px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={TOTAL_STEPS}
        aria-valuenow={step}
        aria-label={`Step ${step} of ${TOTAL_STEPS}`}
        style={{ display: "flex", gap: 6, marginBottom: 28 }}
      >
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
          <span
            key={s}
            aria-hidden
            style={{
              height: 4,
              flex: 1,
              borderRadius: 2,
              background: s <= step ? "var(--accent)" : "var(--line)",
              transition: "background 200ms ease-out",
            }}
          />
        ))}
      </div>

      {step === 1 && (
        <StepEvent
          conference={conference}
          eventId={data.eventId}
          stayStart={data.stayStart}
          stayEnd={data.stayEnd}
          onChange={patch}
          busy={busy}
          error={error}
          onContinue={() =>
            save(
              {
                event_id: data.eventId === "attending" ? (conference?.id ?? null) : null,
                stay_start: data.stayStart || null,
                stay_end: data.stayEnd || null,
              },
              2,
            )
          }
        />
      )}
      {step === 2 && (
        <StepBasics
          userId={userId}
          value={data}
          onChange={patch}
          busy={busy}
          error={error}
          onBack={() => goto(1)}
          onContinue={() =>
            save(
              {
                name: data.name.trim(),
                school: data.school.trim(),
                position: data.position.trim(),
                birthday: data.birthday || null,
                photo_url: data.photo_url,
              },
              3,
            )
          }
        />
      )}
      {step === 3 && (
        <StepInterests
          value={data.interests}
          onChange={(interests) => patch({ interests })}
          busy={busy}
          error={error}
          onBack={() => goto(2)}
          onContinue={() => save({ interests: data.interests }, 4)}
        />
      )}
      {step === 4 && (
        <StepContact
          value={data}
          onChange={patch}
          busy={busy}
          error={error}
          onBack={() => goto(3)}
          onContinue={() =>
            save(
              {
                bio: data.bio.trim(),
                kakao: data.kakao.trim(),
                linkedin: data.linkedin.trim(),
              },
              5,
            )
          }
        />
      )}
      {step === 5 && (
        <StepPlans
          value={data.slotIds}
          onChange={(slotIds) => patch({ slotIds })}
          flight={data.flight}
          onFlightChange={(flight) => patch({ flight })}
          busy={busy}
          error={error}
          onBack={() => goto(4)}
          onFinish={finish}
          conference={conference}
        />
      )}
    </main>
  );
}
