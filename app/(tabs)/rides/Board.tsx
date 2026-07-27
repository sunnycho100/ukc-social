"use client";

import { useState } from "react";
import Link from "next/link";
import { RiderCard } from "./RiderCard";

export type Row = {
  id: string;
  name: string;
  timeLabel: string;
  city: string;
  iata: string;
  airline: string;
  flightNumber: string;
  scheduledMs: number;
  isMe: boolean;
};

const WINDOW_MS = 30 * 60_000; // people within 30 min of you share a car

export function Board({ arrivals, departures }: { arrivals: Row[]; departures: Row[] }) {
  const [dir, setDir] = useState<"arrival" | "departure">("arrival");
  const rows = dir === "arrival" ? arrivals : departures;
  const mine = rows.find((r) => r.isMe);

  return (
    <>
      {/* Plain toggle buttons: tablist semantics without a tabpanel or arrow-key
          handling announce affordances that don't exist. aria-pressed is honest. */}
      <div className="board-dir" role="group" aria-label="Arrivals or departures">
        <button
          type="button"
          aria-pressed={dir === "arrival"}
          className={dir === "arrival" ? "board-dir-on" : "board-dir-off"}
          onClick={() => setDir("arrival")}
        >
          Arrivals
        </button>
        <button
          type="button"
          aria-pressed={dir === "departure"}
          className={dir === "departure" ? "board-dir-on" : "board-dir-off"}
          onClick={() => setDir("departure")}
        >
          Departures
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rides-empty">
          <p className="rides-empty-title">
            No {dir === "arrival" ? "arrivals" : "departures"} posted yet.
          </p>
          <p className="rides-empty-sub">
            Add yours and everyone flying near your time can split a car with you.
          </p>
          <Link href={`/rides/add?d=${dir}`} className="add-btn">
            + Add your {dir === "arrival" ? "arrival" : "departure"}
          </Link>
        </div>
      ) : (
        <>
          {mine && (
            <p className="board-hint">
              Highlighted flights are within 30 min of yours, your best carpool.
            </p>
          )}
          <div className="board">
            {rows.map((r) => (
              <RiderCard
                key={r.id}
                name={r.name}
                timeLabel={r.timeLabel}
                city={r.city}
                iata={r.iata}
                airline={r.airline}
                flightNumber={r.flightNumber}
                isMe={r.isMe}
                inWindow={!!mine && !r.isMe && Math.abs(r.scheduledMs - mine.scheduledMs) <= WINDOW_MS}
              />
            ))}
          </div>
          <Link href={`/rides/add?d=${dir}`} className="add-btn">
            {mine ? "Edit your flight" : `+ Add your ${dir === "arrival" ? "arrival" : "departure"}`}
          </Link>
        </>
      )}
    </>
  );
}
