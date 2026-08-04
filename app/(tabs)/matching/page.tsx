import { requireUser } from "@/lib/supabase/server";
import { getConference } from "@/lib/conference";
import { MealsListSection } from "../meals/page";
import { RidesListSection } from "../rides/page";
import MatchingTabs from "@/components/MatchingTabs";

export default async function MatchingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = (await requireUser()).supabase;
  const [{ tab }, conference, meals, rides] = await Promise.all([
    searchParams,
    getConference(supabase),
    MealsListSection(),
    RidesListSection(),
  ]);
  return (
    <MatchingTabs
      meals={meals}
      rides={rides}
      initialTab={tab === "rides" ? "rides" : "meals"}
    />
  );
}
