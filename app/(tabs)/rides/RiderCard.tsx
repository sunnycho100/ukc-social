"use client";

import { useState } from "react";

export function RiderCard({
  name,
  timeLabel,
  city,
  iata,
  airline,
  flightNumber,
  isMe = false,
  inWindow = false,
}: {
  name: string;
  timeLabel: string;
  city: string;
  iata: string;
  airline: string;
  flightNumber: string;
  isMe?: boolean;
  inWindow?: boolean;
}) {
  const [sent, setSent] = useState(false);

  return (
    <div className={`arr${inWindow ? " arr-hot" : ""}`}>
      <div className="arr-main">
        <div className="arr-time">{timeLabel}</div>
        <div className="arr-body">
          <div className="arr-name">
            <span className="arr-name-text">{name}</span>
            {isMe && <span className="arr-you">You</span>}
            {inWindow && !isMe && <span className="arr-near">±30 min</span>}
          </div>
          <div className="arr-meta">
            {city}
            {iata ? ` (${iata})` : ""}
            {airline || flightNumber ? ` · ${airline} ${flightNumber}`.trimEnd() : ""}
          </div>
        </div>
        {isMe ? (
          <span className="arr-done">Posted</span>
        ) : sent ? (
          <span className="arr-done">Requested</span>
        ) : (
          <button
            type="button"
            className="arr-share"
            onClick={() => setSent(true)}
            aria-label={
              inWindow
                ? `Share a ride with ${name}, within 30 minutes of your flight`
                : `Share a ride with ${name}`
            }
          >
            Share <span aria-hidden>▸</span>
          </button>
        )}
      </div>

      {/* Mounted up front: a live region created in the same commit as its text
          announces unreliably in VoiceOver and NVDA. :empty hides it when idle. */}
      <div className="arr-ack" role="status">
        {sent && !isMe && (
          <>
            <span>{name} gets your name and can message you.</span>
            <button type="button" className="arr-undo" onClick={() => setSent(false)}>
              Undo
            </button>
          </>
        )}
      </div>
    </div>
  );
}
