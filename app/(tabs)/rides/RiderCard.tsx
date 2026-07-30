"use client";

import { useState } from "react";
import { joinRide } from "@/app/actions/flights";

export function RiderCard({
  flightId,
  name,
  timeLabel,
  city,
  iata,
  airline,
  flightNumber,
  isMe = false,
  full = false,
  joined = false,
  inWindow = false,
}: {
  flightId: string;
  name: string;
  timeLabel: string;
  city: string;
  iata: string;
  airline: string;
  flightNumber: string;
  isMe?: boolean;
  full?: boolean;
  joined?: boolean;
  inWindow?: boolean;
}) {
  const [state, setState] = useState<"idle" | "joining" | "joined" | "full" | "error">(
    joined ? "joined" : "idle",
  );

  async function join() {
    setState("joining");
    const res = await joinRide(flightId);
    if (res.ok) setState("joined");
    else if (res.full) setState("full");
    else setState("error");
  }

  return (
    <div className={`arr${inWindow ? " arr-hot" : ""}`}>
      <div className="arr-main">
        <div className="arr-time">{timeLabel}</div>
        <div className="arr-body">
          <div className="arr-name">
            {name}
            {isMe && <span className="arr-you">You</span>}
          </div>
          <div className="arr-meta">
            {city}
            {iata ? ` (${iata})` : ""}
            {airline || flightNumber ? ` · ${airline} ${flightNumber}`.trimEnd() : ""}
          </div>
        </div>
        {isMe ? (
          <span className="arr-done">Posted</span>
        ) : state === "joined" ? (
          <span className="arr-done">Joined ✓</span>
        ) : state === "full" || full ? (
          <span className="arr-done">Full</span>
        ) : (
          <button
            type="button"
            className="arr-share"
            onClick={join}
            disabled={state === "joining"}
            aria-label={`Share a ride with ${name}`}
          >
            {state === "joining" ? "Joining…" : "Share"} <span aria-hidden>▸</span>
          </button>
        )}
      </div>

      {state === "joined" && !isMe && (
        <div className="arr-ack" role="status">
          <span>You&apos;re in this ride with {name} — split the car, find each other at MCO.</span>
        </div>
      )}
      {state === "error" && !isMe && (
        <div className="arr-ack" role="status">
          <span>Couldn&apos;t join. Try again.</span>
        </div>
      )}
    </div>
  );
}
