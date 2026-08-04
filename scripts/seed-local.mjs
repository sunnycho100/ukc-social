// Seeds the LOCAL supabase stack with a mock conference so the app can be
// walked end to end without touching the real project.
//
// Refuses to run against anything but 127.0.0.1/localhost. That guard is the
// whole point: the production URL and the local one differ by a single env
// var, and a seeder pointed at production would write junk profiles into a
// conference real people are already using.
//
// Usage: node scripts/seed-local.mjs
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const host = new global.URL(URL).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  console.error(`refusing to seed a non-local host: ${host}`);
  process.exit(1);
}

const db = createClient(URL, KEY, { auth: { persistSession: false } });

const PASSWORD = "localtest1234";
const TZ = "America/New_York";

// Deliberately messy school spellings. Two people at "UW Madison" and
// "University of Wisconsin-Madison" are at the same school, and the app has to
// know that. Same for the Georgia Tech pair.
const PEOPLE = [
  ["Ari Chen", "University of Wisconsin-Madison", "PhD", ["robotics", "controls", "hiking"]],
  ["Bo Park", "UW Madison", "Master's", ["robotics", "computer vision"]],
  ["Cam Diaz", "Georgia Institute of Technology", "PhD", ["machine learning", "nlp"]],
  ["Dae Kim", "Georgia Tech", "Undergraduate", ["machine learning", "startups"]],
  ["Eli Novak", "Purdue University", "Faculty", ["controls", "aerospace"]],
  ["Fay Oduya", "Purdue University", "Undergraduate", ["aerospace", "climbing"]],
  ["Gus Meyer", "University of Michigan", "Postdoc", ["nlp", "linguistics"]],
  ["Hana Sato", "University of Michigan", "Master's", ["nlp", "music"]],
  ["Ivo Petrov", "KAIST", "Working", ["semiconductors", "photography"]],
  ["Jun Lee", "KAIST", "Undergraduate", ["semiconductors", "gaming"]],
  ["Kira Blum", "MIT", "PhD", ["biotech", "running"]],
  ["Liam Fox", "MIT", "Master's", ["biotech", "cooking"]],
  ["Mina Roy", "Stanford University", "Working", ["startups", "design"]],
  ["Noor Aziz", "Stanford University", "Undergraduate", ["design", "photography"]],
];

const iso = (d) => new Date(d).toISOString();

async function main() {
  const { data: conf, error: cErr } = await db
    .from("conferences")
    .insert({
      name: "UKC 2026 (local mock)",
      location: "Chicago, IL",
      starts_at: iso("2026-08-05T12:00:00Z"),
      ends_at: iso("2026-08-08T22:00:00Z"),
      timezone: TZ,
      airport_code: "ORD",
      announcement: "Badge pickup opens at 8am in the main lobby. Shuttles run every 20 minutes.",
    })
    .select("id")
    .single();
  if (cErr) throw cErr;

  const days = ["2026-08-05", "2026-08-06", "2026-08-07"];
  const agenda = [
    ["09:00", "10:30", "Opening keynote"],
    ["11:00", "12:30", "Technical sessions"],
    ["14:00", "15:30", "Poster session"],
    ["16:00", "17:30", "Panel: careers after the PhD"],
  ];
  await db.from("schedule_items").insert(
    days.flatMap((d, di) =>
      agenda.map(([s, e, title], i) => ({
        starts_at: iso(`${d}T${s}:00-04:00`),
        ends_at: iso(`${d}T${e}:00-04:00`),
        title: `${title} (Day ${di + 1})`,
        sort_order: i,
      })),
    ),
  );

  // join_deadline in the past for the first two slots (already revealed) and in
  // the future for the last two, so both sides of the reveal gate are walkable.
  const slotRows = [
    ["Day 1 Dinner", "2026-08-05T19:00:00-04:00", "2026-08-05T12:00:00-04:00"],
    ["Day 2 Dinner", "2026-08-06T19:00:00-04:00", "2026-08-06T12:00:00-04:00"],
    ["Day 3 Dinner", "2026-08-07T19:00:00-04:00", "2030-01-01T00:00:00Z"],
    ["Farewell Lunch", "2026-08-08T12:30:00-04:00", "2030-01-01T00:00:00Z"],
  ];
  const { data: slots, error: sErr } = await db
    .from("slots")
    .insert(
      slotRows.map(([title, starts_at, join_deadline]) => ({
        title,
        starts_at: iso(starts_at),
        join_deadline: iso(join_deadline),
        area: "Downtown",
      })),
    )
    .select("id, title");
  if (sErr) throw sErr;

  const users = [];
  for (const [i, [name, school, position, interests]] of PEOPLE.entries()) {
    const email = `local${i + 1}@example.test`;
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    users.push({ id: data.user.id, email, name });
    const { error: pErr } = await db.from("profiles").insert({
      id: data.user.id,
      name,
      school,
      position,
      interests,
      bio: `${position} at ${school}.`,
      event_id: conf.id,
      stay_start: "2026-08-05",
      stay_end: "2026-08-08",
      mentor_optin: true,
    });
    if (pErr) throw pErr;
  }

  // Everyone joins the first two dinners; a thinner crowd on the later two, so
  // the "not enough people yet" path is reachable too.
  await db.from("signups").insert([
    ...users.map((u) => ({ slot_id: slots[0].id, user_id: u.id })),
    ...users.slice(0, 9).map((u) => ({ slot_id: slots[1].id, user_id: u.id })),
    ...users.slice(0, 5).map((u) => ({ slot_id: slots[2].id, user_id: u.id })),
    ...users.slice(0, 2).map((u) => ({ slot_id: slots[3].id, user_id: u.id })),
  ]);

  console.log(`conference ${conf.id}`);
  console.log(`slots      ${slots.length}`);
  console.log(`users      ${users.length}  (password: ${PASSWORD})`);
  console.log(users.map((u) => `  ${u.email}  ${u.name}`).join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
