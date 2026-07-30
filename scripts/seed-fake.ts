// Seeds 20 fake users + profiles + signups on the "Day 2 Dinner" slot.
// Run: npx tsx scripts/seed-fake.ts  (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
import { createClient } from "@supabase/supabase-js";

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// Frozen-universe cast, standing in as mock profiles — see
// "Icebreaker Design Guide.dc.html" for the naming glossary this follows.
const NAMES = [
  "Anna", "Kristoff", "Elsa", "Olaf", "Sven",
  "Hans", "Honeymaren", "Ryder", "Mattias", "Yelena",
  "Grand Pabbie", "Bulda", "Oaken", "Iduna", "Agnarr",
  "Gerda", "Kai", "Marshmallow", "Gale", "Bruni",
];
const SCHOOLS = [
  "Arendelle Castle", "Ice Harvesters Guild", "North Mountain Keep", "Snowgies Division",
  "North Mountain Guides", "Northuldra Reindeer Riders", "Arendelle Royal Guard",
  "Troll Valley", "Oaken's Trading Post", "Enchanted Forest",
];
const POSITIONS = ["Royal Diplomat", "Mountain Guide", "Ice Magic Systems", "Field Captain", "Elder Relations"];
const INTERESTS = [
  "Robotics", "Perception", "NLP / Agents", "Computer Vision", "HCI", "RL",
  "Bioengineering", "Materials", "Energy", "Semiconductors", "국밥 crew",
  "Night owl", "Coffee chat",
];

// Deterministic pick so reruns produce identical profiles.
const pick = <T,>(arr: T[], i: number) => arr[i % arr.length];
const interestsFor = (i: number) => [
  pick(INTERESTS, i),
  pick(INTERESTS, i + 3),
  pick(INTERESTS, i + 7),
].filter((v, idx, a) => a.indexOf(v) === idx);

async function main() {
  const { data: slot, error: slotErr } = await svc
    .from("slots")
    .select("id")
    .eq("title", "Day 2 Dinner")
    .single();
  if (slotErr || !slot) throw new Error(`No "Day 2 Dinner" slot: ${slotErr?.message ?? "not found"}`);

  let users = 0;
  let signups = 0;

  for (let i = 0; i < NAMES.length; i++) {
    const email = `fake${i}@ukctest.dev`;
    let userId: string;

    const { data: created, error: cErr } = await svc.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (created?.user) {
      userId = created.user.id;
      users++;
    } else {
      // Already exists — find their profile id via the matching upserted profile.
      // profiles.id === auth user id, so look it up by name (seeded, stable).
      const { data: prof } = await svc
        .from("profiles")
        .select("id")
        .eq("name", NAMES[i])
        .single();
      if (!prof) throw new Error(`createUser failed and no profile for ${email}: ${cErr?.message}`);
      userId = prof.id as string;
    }

    const { error: pErr } = await svc.from("profiles").upsert({
      id: userId,
      name: NAMES[i],
      school: pick(SCHOOLS, i),
      position: pick(POSITIONS, i),
      interests: interestsFor(i),
    });
    if (pErr) throw new Error(`profile upsert ${email}: ${pErr.message}`);

    const { error: sErr } = await svc
      .from("signups")
      .upsert(
        { slot_id: slot.id, user_id: userId },
        { onConflict: "slot_id,user_id", ignoreDuplicates: true },
      );
    if (sErr) throw new Error(`signup ${email}: ${sErr.message}`);
    signups++;
  }

  console.log(`seeded ${users} users, ${signups} signups`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
