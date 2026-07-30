import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { getConference } from "@/lib/conference";
import GroupReveal from "@/components/GroupReveal";

export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, supabase } = await requireUser();
  const conference = await getConference(supabase);

  // RLS restricts groups/group_members to members — a non-member gets null → 404.
  const { data: group } = await supabase
    .from("groups")
    .select("id, name, rationale, starter_question, meet_time, slot_id, slot:slots(title, starts_at, area)")
    .eq("id", id)
    .maybeSingle();
  if (!group) notFound();

  const { data: rows } = await supabase
    .from("group_members")
    .select("user_id, profile:profiles(name, photo_url, school, position, interests, kakao, linkedin)")
    .eq("group_id", id);

  // party_size lives on the slot signup; su_sel lets members read it. Map user → headcount.
  const { data: sus } = await supabase
    .from("signups")
    .select("user_id, party_size")
    .eq("slot_id", (group as any).slot_id);
  const sizeById = new Map((sus ?? []).map((s: any) => [s.user_id, s.party_size ?? 1]));

  const members = (rows ?? []).map((r: any) => ({
    userId: r.user_id as string,
    partySize: sizeById.get(r.user_id) ?? 1,
    ...r.profile,
  }));

  const slot = Array.isArray((group as any).slot)
    ? (group as any).slot[0]
    : (group as any).slot;

  return (
    <GroupReveal
      groupId={group.id}
      name={group.name}
      rationale={group.rationale}
      starterQuestion={group.starter_question}
      meetTime={group.meet_time}
      slotTitle={slot?.title ?? ""}
      slotStartsAt={slot?.starts_at ?? null}
      slotArea={slot?.area ?? ""}
      members={members}
      meId={user.id}
      timezone={conference?.timezone}
    />
  );
}
