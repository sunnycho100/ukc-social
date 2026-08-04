import { describe, it, expect, vi } from "vitest";

// Same trick as matchRunner.test.ts: force the LLM call to fail so seating runs
// through round-robin. This file is about the rules that hold whatever the
// matcher decides, so it must not depend on a model or an API key.
vi.mock("./matching", async () => {
  const actual = await vi.importActual<typeof import("./matching")>("./matching");
  return { ...actual, matchSlot: vi.fn(async () => { throw new Error("no key"); }) };
});

const { matchOneSlot } = await import("./matchRunner");

const SLOT = { id: "slot-1", starts_at: "2026-08-06T18:00:00Z", join_deadline: "2026-08-06T12:00:00Z" };

type Row = Record<string, unknown>;

// A fake that keeps its rows between calls, unlike the per-call fixtures in
// matchRunner.test.ts. Seating is incremental, so the interesting behaviour
// only shows up across repeated runs against state the previous run wrote.
function makeDb() {
  const signups: Row[] = [];
  const groups: Row[] = [];
  const members: { group_id: string; user_id: string }[] = [];
  let gid = 0;

  const from = (table: string) => {
    const state = { table, op: "select" as "select" | "insert", payload: null as unknown };
    const api = {
      select: () => api,
      eq: () => api,
      insert(rows: unknown) {
        state.op = "insert";
        state.payload = rows;
        return api;
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        let res: { data: unknown; error: unknown } = { data: [], error: null };
        if (state.op === "insert") {
          const rows = state.payload as Row[];
          if (table === "groups") {
            const made = rows.map((r) => ({ ...r, id: `g${++gid}` }));
            groups.push(...made);
            res = { data: made.map((m) => ({ id: m.id })), error: null };
          } else if (table === "group_members") {
            members.push(...(rows as { group_id: string; user_id: string }[]));
            res = { data: rows, error: null };
          } else {
            res = { data: rows, error: null };
          }
        } else if (table === "signups") {
          res = { data: signups, error: null };
        } else if (table === "group_members") {
          res = { data: members.map((m) => ({ user_id: m.user_id })), error: null };
        }
        return Promise.resolve(res).then(resolve, reject);
      },
    };
    return api;
  };

  return {
    svc: { from } as never,
    signups,
    groups,
    members,
    join(n: number, partySize = 1) {
      signups.push({
        user_id: `u${n}`,
        party_size: partySize,
        notes: "",
        profiles: {
          name: `Person ${n}`,
          school: "UKC",
          position: "phd",
          interests: ["robotics"],
          event_id: "conf-1",
          stay_start: "2026-08-04",
          stay_end: "2026-08-08",
        },
      });
    },
    tables() {
      return groups.map((g) => ({
        id: g.id as string,
        seats: members.filter((m) => m.group_id === g.id).map((m) => m.user_id).sort(),
      }));
    },
  };
}

const sizeOf = (db: ReturnType<typeof makeDb>, seats: string[]) =>
  seats.reduce((n, id) => {
    const s = db.signups.find((r) => r.user_id === id);
    return n + ((s?.party_size as number) ?? 1);
  }, 0);

describe("a slot filling up over several runs", () => {
  it("never seats anyone twice and never moves anyone already seated", async () => {
    const db = makeDb();
    // Arrivals in the shape a real slot fills: a first wave, then stragglers.
    const waves = [8, 3, 1, 5, 2, 6];
    let n = 0;
    const seen: string[][] = [];

    for (const wave of waves) {
      for (let i = 0; i < wave; i++) db.join(++n);
      await matchOneSlot(db.svc, SLOT, null);
      seen.push(db.tables().map((t) => t.seats.join(",")));
    }

    // Guard against the assertions below passing on an empty run.
    expect(seen[0].length).toBeGreaterThan(0);
    expect(seen[seen.length - 1].length).toBeGreaterThan(seen[0].length);

    // Nobody holds two seats.
    const allSeats = db.members.map((m) => m.user_id);
    expect(new Set(allSeats).size).toBe(allSeats.length);

    // Every table that existed after a run still has exactly the same people
    // after every later run. This is the promise that lets the cron re-run
    // safely once people have been told who they are sitting with.
    for (let r = 1; r < seen.length; r++) {
      for (const table of seen[r - 1]) expect(seen[r]).toContain(table);
    }
  });

  it("seats everyone once the slot has stopped growing", async () => {
    const db = makeDb();
    for (let i = 1; i <= 25; i++) db.join(i);
    await matchOneSlot(db.svc, SLOT, null);
    // One more run to sweep up anyone held back as too small a leftover.
    db.join(26);
    db.join(27);
    db.join(28);
    db.join(29);
    await matchOneSlot(db.svc, SLOT, null);

    const seated = new Set(db.members.map((m) => m.user_id));
    expect(seated.size).toBe(29);
  });

  it("keeps every table inside its seat bounds by headcount", async () => {
    const db = makeDb();
    // A mix of solos and parties, which is where headcount and member count
    // stop agreeing.
    [1, 1, 3, 1, 2, 1, 1, 4, 1, 2, 1, 1, 3, 1, 1].forEach((party, i) => db.join(i + 1, party));
    await matchOneSlot(db.svc, SLOT, null);

    for (const t of db.tables()) {
      expect(sizeOf(db, t.seats)).toBeLessThanOrEqual(6);
    }
  });

  it("gates every table it creates, on the first run and on later ones", async () => {
    const db = makeDb();
    for (let i = 1; i <= 8; i++) db.join(i);
    await matchOneSlot(db.svc, SLOT, null);
    for (let i = 9; i <= 14; i++) db.join(i);
    await matchOneSlot(db.svc, SLOT, null);

    expect(db.groups.length).toBeGreaterThan(1);
    expect(db.groups.every((g) => g.reveal_at === SLOT.join_deadline)).toBe(true);
  });

  it("holds a lone straggler back rather than seating a table of one", async () => {
    const db = makeDb();
    for (let i = 1; i <= 8; i++) db.join(i);
    await matchOneSlot(db.svc, SLOT, null);
    const before = db.tables().length;

    db.join(9);
    const r = await matchOneSlot(db.svc, SLOT, null);

    expect(r.waiting).toBe(1);
    expect(db.tables().length).toBe(before);
    expect(db.members.some((m) => m.user_id === "u9")).toBe(false);
  });
});
