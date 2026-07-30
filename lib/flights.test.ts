import { describe, it, expect, afterEach, vi } from "vitest";
import { bucketIntoPools, delayMinutes, fetchArrivals, type Arrival } from "./flights";

const a = (flightNumber: string, estimatedLocal: string, extra: Partial<Arrival> = {}): Arrival => ({
  flightNumber, airline: "Test", originIata: "XXX", originCity: "X",
  scheduledLocal: estimatedLocal, estimatedLocal, status: "scheduled", ...extra,
});

describe("delayMinutes", () => {
  it("is 0 when on time and positive when revised later", () => {
    expect(delayMinutes(a("ON1", "2026-08-04T14:00:00-04:00"))).toBe(0);
    expect(
      delayMinutes(a("DL1", "2026-08-04T14:00:00-04:00", {
        scheduledLocal: "2026-08-04T13:30:00-04:00",
        estimatedLocal: "2026-08-04T14:00:00-04:00",
      })),
    ).toBe(30);
  });

  it("clamps to 0 for an early arrival instead of going negative", () => {
    expect(
      delayMinutes(a("EARLY1", "2026-08-04T13:45:00-04:00", {
        scheduledLocal: "2026-08-04T14:00:00-04:00",
        estimatedLocal: "2026-08-04T13:45:00-04:00",
      })),
    ).toBe(0);
  });
});

describe("bucketIntoPools", () => {
  it("groups arrivals within the window and starts a new pool past it", () => {
    const pools = bucketIntoPools(
      [
        a("F1", "2026-08-04T14:00:00-04:00"),
        a("F2", "2026-08-04T14:20:00-04:00"), // within 30m of F1
        a("F3", "2026-08-04T14:45:00-04:00"), // >30m past F1 -> new pool
      ],
      30,
    );
    expect(pools.length).toBe(2);
    expect(pools[0].arrivals.map((x) => x.flightNumber)).toEqual(["F1", "F2"]);
    expect(pools[1].arrivals.map((x) => x.flightNumber)).toEqual(["F3"]);
  });

  it("excludes cancelled flights and sorts by estimated time", () => {
    const pools = bucketIntoPools([
      a("LATE", "2026-08-04T18:00:00-04:00"),
      a("GONE", "2026-08-04T14:00:00-04:00", { status: "cancelled" }),
      a("EARLY", "2026-08-04T14:05:00-04:00"),
    ]);
    const flights = pools.flatMap((p) => p.arrivals.map((x) => x.flightNumber));
    expect(flights).toEqual(["EARLY", "LATE"]);
  });

  it("returns no pools for an empty arrivals list", () => {
    expect(bucketIntoPools([])).toEqual([]);
  });

  it("returns no pools when every arrival is cancelled", () => {
    expect(
      bucketIntoPools([
        a("C1", "2026-08-04T14:00:00-04:00", { status: "cancelled" }),
        a("C2", "2026-08-04T14:10:00-04:00", { status: "cancelled" }),
      ]),
    ).toEqual([]);
  });

  it("anchors the window to the pool's first arrival, not a rolling/sliding window", () => {
    // F1@14:00, F2@14:25 (within 30m of F1 -> joins), F3@14:50 (25m after F2, but
    // 50m after F1 -> new pool). This locks in "anchor to first", not "gap to prev".
    const pools = bucketIntoPools(
      [
        a("F1", "2026-08-04T14:00:00-04:00"),
        a("F2", "2026-08-04T14:25:00-04:00"),
        a("F3", "2026-08-04T14:50:00-04:00"),
      ],
      30,
    );
    expect(pools.length).toBe(2);
    expect(pools[0].arrivals.map((x) => x.flightNumber)).toEqual(["F1", "F2"]);
    expect(pools[1].arrivals.map((x) => x.flightNumber)).toEqual(["F3"]);
  });
});

describe("fetchArrivals — AeroDataBox live path (mocked fetch)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubAdb(arrivals: unknown[]) {
    vi.stubEnv("AERODATABOX_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ arrivals }),
      }),
    );
  }

  it("infers cancelled/landed/delayed/scheduled from the raw status text", async () => {
    stubAdb([
      { number: "DL 123", status: "Cancelled", arrival: { scheduledTime: { local: "2026-08-04 14:00-04:00" } } },
      {
        number: "AA456",
        status: "Arrived",
        arrival: {
          scheduledTime: { local: "2026-08-04 14:00-04:00" },
          revisedTime: { local: "2026-08-04 14:00-04:00" },
        },
      },
      {
        number: "UA789",
        status: "Expected",
        arrival: {
          scheduledTime: { local: "2026-08-04 14:00-04:00" },
          revisedTime: { local: "2026-08-04 14:30-04:00" },
        },
      },
      { number: "B6001", status: "Expected", arrival: { scheduledTime: { local: "2026-08-04 14:00-04:00" } } },
    ]);
    const arrivals = await fetchArrivals("MCO", "2026-08-04T12:00", "2026-08-04T20:00");
    const byFlight = new Map(arrivals.map((x) => [x.flightNumber, x]));
    expect(byFlight.get("DL123")?.status).toBe("cancelled");
    expect(byFlight.get("AA456")?.status).toBe("landed");
    expect(byFlight.get("UA789")?.status).toBe("delayed");
    expect(byFlight.get("B6001")?.status).toBe("scheduled");
    // Whitespace in the raw flight number ("DL 123") is stripped.
    expect([...byFlight.keys()]).toContain("DL123");
    // B6001 had no revisedTime at all — estimatedLocal falls back to scheduledLocal.
    expect(byFlight.get("B6001")?.estimatedLocal).toBe(byFlight.get("B6001")?.scheduledLocal);
  });

  it("falls back to the seed data if the AeroDataBox request fails", async () => {
    vi.stubEnv("AERODATABOX_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const arrivals = await fetchArrivals("MCO", "2026-08-04T12:00", "2026-08-04T20:00");
    expect(arrivals.length).toBeGreaterThan(5); // the bundled example, not empty
  });
});

describe("fetchArrivals (seed fallback, no API key)", () => {
  it("returns the Aug-4 MCO example and buckets it into shareable pools", async () => {
    const arrivals = await fetchArrivals("MCO", "2026-08-04T12:00", "2026-08-04T20:00");
    expect(arrivals.length).toBeGreaterThan(5);
    expect(arrivals.some((x) => x.status === "delayed")).toBe(true);
    const pools = bucketIntoPools(arrivals, 30);
    expect(pools.length).toBeGreaterThan(1);
    // cancelled flight (F9210) is never poolable
    expect(pools.flatMap((p) => p.arrivals).some((x) => x.status === "cancelled")).toBe(false);
  });

  it("returns nothing for an airport we have no data for", async () => {
    expect(await fetchArrivals("SFO", "2026-08-04T12:00", "2026-08-04T20:00")).toEqual([]);
  });
});
