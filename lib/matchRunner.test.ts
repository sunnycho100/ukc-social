import { describe, it, expect, vi } from "vitest";

// matchSlot is the LLM call. Forcing it to throw drives matchOneSlot down its
// documented round-robin fallback, so these tests describe the seating rules
// without an API key and without a model in the loop.
vi.mock("./matching", async () => {
  const actual = await vi.importActual<typeof import("./matching")>("./matching");
  return { ...actual, matchSlot: vi.fn(async () => { throw new Error("no key"); }) };
});

const { matchOneSlot } = await import("./matchRunner");

const SLOT = { id: "slot-1", starts_at: "2026-08-06T18:00:00Z" };

type Call = { table: string; op: string; payload: unknown; cols?: string };

// Returns one row id per group being inserted, the way PostgREST does, so
// matchOneSlot's inserted-row-to-group zip lines up.
const insertedIds = (state: Call) => ({
  data: (state.payload as unknown[]).map((_, i) => ({ id: `g-new-${i + 1}` })),
  error: null,
});

// Minimal stand-in for the PostgREST builder: chainable, thenable, and it
// records every call so a test can assert on what was written (and, more to
// the point here, on what was not).
type Fixture =
  | { data: unknown; error: unknown }
  | ((state: Call) => { data: unknown; error: unknown });

function makeSvc(fixtures: Record<string, Fixture>) {
  const calls: Call[] = [];
  function from(table: string) {
    const state: Call = { table, op: "select", payload: null };
    const api = {
      select(cols: string) {
        state.cols = cols;
        return api;
      },
      eq() {
        return api;
      },
      insert(rows: unknown) {
        state.op = "insert";
        state.payload = rows;
        calls.push(state);
        return api;
      },
      delete() {
        state.op = "delete";
        calls.push(state);
        return api;
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        if (state.op === "select") calls.push(state);
        const f = fixtures[`${table}:${state.op}`] ?? { data: [], error: null };
        const res = typeof f === "function" ? f(state) : f;
        return Promise.resolve(res).then(resolve, reject);
      },
    };
    return api;
  }
  return { svc: { from } as never, calls };
}

const signup = (n: number) => ({
  user_id: `u${n}`,
  party_size: 1,
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

const setup = (signupCount: number, seatedIds: string[]) =>
  makeSvc({
    "signups:select": {
      data: Array.from({ length: signupCount }, (_, i) => signup(i + 1)),
      error: null,
    },
    "group_members:select": { data: seatedIds.map((user_id) => ({ user_id })), error: null },
    "groups:insert": insertedIds,
  });

const memberIds = (calls: Call[]) =>
  (calls.find((c) => c.table === "group_members" && c.op === "insert")?.payload as
    | { user_id: string }[]
    | undefined) ?? [];

describe("matchOneSlot seating", () => {
  it("seats everyone when the slot has no tables yet", async () => {
    const { svc, calls } = setup(8, []);
    const r = await matchOneSlot(svc, SLOT, null);

    expect(r.ok).toBe(true);
    expect(r.alreadySeated).toBe(0);
    expect(memberIds(calls).map((m) => m.user_id).sort()).toEqual([
      "u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8",
    ]);
  });

  it("seats only the signups that joined since the last run", async () => {
    const { svc, calls } = setup(9, ["u1", "u2", "u3", "u4"]);
    const r = await matchOneSlot(svc, SLOT, null);

    expect(r.ok).toBe(true);
    expect(r.alreadySeated).toBe(4);
    expect(memberIds(calls).map((m) => m.user_id).sort()).toEqual(["u5", "u6", "u7", "u8", "u9"]);
  });

  it("never deletes existing groups", async () => {
    const { svc, calls } = setup(9, ["u1", "u2", "u3", "u4"]);
    await matchOneSlot(svc, SLOT, null);

    expect(calls.filter((c) => c.op === "delete")).toEqual([]);
  });

  it("notifies only the newly seated", async () => {
    const { svc, calls } = setup(9, ["u1", "u2", "u3", "u4"]);
    await matchOneSlot(svc, SLOT, null);

    const notified = (calls.find((c) => c.table === "notifications")?.payload ??
      []) as { user_id: string; type: string }[];
    expect(notified.map((n) => n.user_id).sort()).toEqual(["u5", "u6", "u7", "u8", "u9"]);
    expect(notified.every((n) => n.type === "table_revealed")).toBe(true);
  });

  it("writes nothing when everyone signed up is already seated", async () => {
    const { svc, calls } = setup(4, ["u1", "u2", "u3", "u4"]);
    const r = await matchOneSlot(svc, SLOT, null);

    expect(r).toEqual({ ok: true, groups: 0, excluded: 0, alreadySeated: 4 });
    expect(calls.filter((c) => c.op === "insert")).toEqual([]);
  });

  // matchSlot is mocked to throw for this whole file, which is exactly the
  // shape of a missing OPENAI_API_KEY. Every table comes out round-robin,
  // and the result has to say so rather than looking like a clean run.
  it("reports the fallback when nothing was matched by interest", async () => {
    const { svc } = setup(8, []);
    const r = await matchOneSlot(svc, SLOT, null);

    expect(r.groups).toBeGreaterThan(0);
    expect(r.matcher).toBe("fallback");
  });

  // The live database had exactly one unseated person on three of four slots.
  // Seating them would have produced a table of one and told a real person
  // their table was set.
  it("holds back a leftover too small to be a table, instead of seating one person", async () => {
    const { svc, calls } = setup(6, ["u1", "u2", "u3", "u4", "u5"]);
    const r = await matchOneSlot(svc, SLOT, null);

    expect(r.ok).toBe(true);
    expect(r.groups).toBe(0);
    expect(r.waiting).toBe(1);
    expect(calls.filter((c) => c.op === "insert")).toEqual([]);
  });

  it("seats the leftover once enough people are waiting", async () => {
    const { svc, calls } = setup(9, ["u1", "u2", "u3", "u4", "u5"]);
    const r = await matchOneSlot(svc, SLOT, null);

    expect(r.groups).toBeGreaterThan(0);
    expect(r.waiting).toBeUndefined();
    expect(memberIds(calls).map((m) => m.user_id).sort()).toEqual(["u6", "u7", "u8", "u9"]);
  });

  // A slot's first run is not a leftover, it is the whole dinner, so a small
  // turnout still gets seated.
  it("still seats a small first run when the slot has no tables yet", async () => {
    const { svc, calls } = setup(2, []);
    const r = await matchOneSlot(svc, SLOT, null);

    expect(r.groups).toBe(1);
    expect(r.waiting).toBeUndefined();
    expect(memberIds(calls).map((m) => m.user_id).sort()).toEqual(["u1", "u2"]);
  });

  it("counts schedule-excluded signups only among the unseated", async () => {
    const { svc } = makeSvc({
      "signups:select": {
        // u1 is seated already; u2 opted out of the conference (no event_id).
        data: [
          signup(1),
          { ...signup(2), profiles: { ...signup(2).profiles, event_id: null } },
          signup(3),
          signup(4),
          signup(5),
          signup(6),
        ],
        error: null,
      },
      "group_members:select": { data: [{ user_id: "u1" }], error: null },
      "groups:insert": insertedIds,
    });
    const r = await matchOneSlot(svc, SLOT, null);

    expect(r.alreadySeated).toBe(1);
    expect(r.excluded).toBe(1);
  });
});

// Migration 0026 gates the whole reveal in RLS, but RLS only has something to
// gate if the writer stamps the rows on the way in. These cover the writer.
describe("matchOneSlot reveal gate", () => {
  const DEADLINE = "2026-08-05T21:00:00Z";
  const GATED = { ...SLOT, join_deadline: DEADLINE };

  const inserts = (calls: Call[], table: string) =>
    (calls.find((c) => c.table === table && c.op === "insert")?.payload ?? []) as Record<
      string,
      unknown
    >[];

  it("stamps every table with the slot's join deadline", async () => {
    const { svc, calls } = setup(8, []);
    await matchOneSlot(svc, GATED, null);

    const groups = inserts(calls, "groups");
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => g.reveal_at === DEADLINE)).toBe(true);
  });

  it("holds the bell back to the same moment as the table", async () => {
    const { svc, calls } = setup(8, []);
    await matchOneSlot(svc, GATED, null);

    const notifs = inserts(calls, "notifications");
    expect(notifs.length).toBeGreaterThan(0);
    expect(notifs.every((n) => n.visible_at === DEADLINE)).toBe(true);
  });

  // A slot with no deadline has nothing to wait for, so it must behave exactly
  // as it did before 0026: table readable now, bell rings now. reveal_at null
  // reads as "revealed" in group_revealed(), and an omitted visible_at takes
  // the column default of now().
  it("leaves a deadline-less slot open, not sealed forever", async () => {
    const { svc, calls } = setup(8, []);
    await matchOneSlot(svc, SLOT, null);

    expect(inserts(calls, "groups").every((g) => g.reveal_at === null)).toBe(true);
    expect(inserts(calls, "notifications").every((n) => !("visible_at" in n))).toBe(true);
  });

  // The top-up case: someone who joins after the first run is seated at a new
  // table, and that table has to carry the gate too. A late table stamped null
  // would be readable immediately while everyone else's stayed shut.
  it("gates a table seated on a later top-up run", async () => {
    const { svc, calls } = setup(9, ["u1", "u2", "u3", "u4"]);
    await matchOneSlot(svc, GATED, null);

    const groups = inserts(calls, "groups");
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => g.reveal_at === DEADLINE)).toBe(true);
  });
});
