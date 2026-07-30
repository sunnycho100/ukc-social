import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { getConference } from "@/lib/conference";
import Chat from "@/components/Chat";

export default async function GroupChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, supabase } = await requireUser();
  const conference = await getConference(supabase);

  // RLS gives members-only access — a non-member gets null → 404.
  const { data: group } = await supabase
    .from("groups")
    .select("id, name, starter_question, meet_time")
    .eq("id", id)
    .maybeSingle();
  if (!group) notFound();

  // Opening the thread marks it read — powers the unread badge on /chat's index.
  // Non-fatal: a failed upsert just leaves the badge stale, not a broken page.
  await supabase
    .from("message_reads")
    .upsert(
      { user_id: user.id, group_id: group.id, last_read_at: new Date().toISOString() },
      { onConflict: "user_id,group_id" },
    );

  // The roster: who a member is talking to. Seeds the header, empty state,
  // and per-message avatars so nobody is an anonymous bubble.
  const { data: rows } = await supabase
    .from("group_members")
    .select("user_id, profile:profiles(name, photo_url)")
    .eq("group_id", id);

  const members = (rows ?? []).map((r: any) => ({
    userId: r.user_id as string,
    name: (r.profile?.name as string) ?? "Someone",
    photo_url: (r.profile?.photo_url as string | null) ?? null,
  }));

  return (
    <Chat
      channelType="meal"
      channelId={group.id}
      currentUserId={user.id}
      groupId={group.id}
      groupName={group.name}
      members={members}
      starterQuestion={group.starter_question ?? null}
      meetTime={group.meet_time ?? null}
      timezone={conference?.timezone}
    />
  );
}
