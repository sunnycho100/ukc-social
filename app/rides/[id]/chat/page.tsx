import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { getConference } from "@/lib/conference";
import Chat from "@/components/Chat";

export default async function RideChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, supabase } = await requireUser();
  const conference = await getConference(supabase);

  // RLS gives members-only access — a non-member gets null → 404.
  const { data: pool } = await supabase
    .from("ride_pools")
    .select("id, direction, pickup_at, title")
    .eq("id", id)
    .maybeSingle();
  if (!pool) notFound();

  const { data: rows } = await supabase
    .from("ride_members")
    .select("user_id, profile:profiles(name, photo_url)")
    .eq("pool_id", id);

  type ProfileRef = { name: string | null; photo_url: string | null };
  const members = (
    (rows ?? []) as { user_id: string; profile: ProfileRef | ProfileRef[] | null }[]
  ).map((r) => {
    const p = Array.isArray(r.profile) ? r.profile[0] : r.profile;
    return {
      userId: r.user_id,
      name: p?.name ?? "Someone",
      photo_url: p?.photo_url ?? null,
    };
  });

  // A hangout carries its own destination; the two flight pools do not have one
  // beyond the airport, so they keep their fixed labels.
  const groupName =
    pool.direction === "hangout"
      ? pool.title || "Hangout"
      : pool.direction === "arrival"
        ? "Arrival ride"
        : "Departure ride";

  return (
    <Chat
      channelType="ride"
      channelId={pool.id}
      currentUserId={user.id}
      groupId={pool.id}
      groupName={groupName}
      members={members}
      starterQuestion={null}
      meetTime={pool.pickup_at ?? null}
      timezone={conference?.timezone}
    />
  );
}
