import { requireUser } from "@/lib/supabase/server";
import { getConference } from "@/lib/conference";
import { MealsListSection } from "../meals/page";
import { RidesListSection } from "../rides/page";
import MatchingTabs from "@/components/MatchingTabs";

export default async function MatchingPage() {
  const supabase = (await requireUser()).supabase;
  const [conference, meals, rides] = await Promise.all([
    getConference(supabase),
    MealsListSection(),
    RidesListSection(),
  ]);
  return <MatchingTabs kicker={conference?.name ?? "Icebreaker"} meals={meals} rides={rides} />;
}
