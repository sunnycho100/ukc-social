"use server";

import { requireUser } from "@/lib/supabase/server";
import { getConference } from "@/lib/conference";
import { serviceClient } from "@/lib/supabase/service";
import { clampSeats } from "@/lib/hangouts";

type Result = { ok: boolean; error?: string };

// Deliberately not folded into app/actions/flights.ts. Every action there
// assumes the caller has a flights row, and re-centers the pool's pickup time
// on the average of every member's flight as people join and leave. A hangout
// has neither: the leave-by time is whatever the person who started it set, and
// it stays put, because everyone else is joining a departure that was already
// declared rather than negotiating a new one.

export async function createHangout(input: {
  title: string;
  localDateTime: string;
  seats: number;
}): Promise<Result & { poolId?: string }> {
  const { user, supabase } = await requireUser();

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Where are you heading?" };
  if (title.length > 80) return { ok: false, error: "Keep the destination under 80 characters." };
  if (!input.localDateTime) return { ok: false, error: "Set a time to leave by." };

  const conference = await getConference(supabase);
  const leaveAt = new Date(`${input.localDateTime}:00${conference?.utc_offset ?? "-04:00"}`);
  if (isNaN(leaveAt.getTime())) return { ok: false, error: "That time didn't parse." };

  const { data: pool, error } = await supabase
    .from("ride_pools")
    .insert({
      direction: "hangout",
      airport: "",
      title,
      pickup_at: leaveAt.toISOString(),
      capacity: clampSeats(input.seats),
      meet_point: "Hotel lobby",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  // The person who starts it is just the first member, same row shape as
  // everyone after them, so leaving works identically for them.
  const { error: memberErr } = await supabase.from("ride_members").insert({
    pool_id: pool.id,
    user_id: user.id,
    ready_at: leaveAt.toISOString(),
  });
  if (memberErr) {
    // Otherwise the board carries a hangout with nobody in it that nobody can
    // clear, since leaving is the only thing that deletes a pool. Service-role
    // because clients hold no delete grant on ride_pools (migration 0022).
    await serviceClient().from("ride_pools").delete().eq("id", pool.id);
    return { ok: false, error: memberErr.message };
  }

  return { ok: true, poolId: pool.id };
}

export async function joinHangout(poolId: string): Promise<Result & { full?: boolean }> {
  const { user, supabase } = await requireUser();

  const { data: pool } = await supabase
    .from("ride_pools")
    .select("id, direction, capacity, pickup_at")
    .eq("id", poolId)
    .maybeSingle();
  if (!pool || pool.direction !== "hangout") {
    return { ok: false, error: "That hangout isn't around anymore." };
  }

  const { data: existing, error: readErr } = await supabase
    .from("ride_members")
    .select("user_id")
    .eq("pool_id", poolId);
  if (readErr) return { ok: false, error: readErr.message };
  // Already in it (double tap, second tab) is a success, not an error.
  if (existing?.some((m) => m.user_id === user.id)) return { ok: true };
  // ponytail: last-seat race is read-then-write, so two simultaneous joins can
  // both pass. At conference scale the overshoot is one seat; move the check
  // into a trigger or a unique partial index if it ever matters.
  if ((existing?.length ?? 0) >= pool.capacity) {
    return { ok: false, error: "That one just filled up.", full: true };
  }

  const { error } = await supabase.from("ride_members").insert({
    pool_id: poolId,
    user_id: user.id,
    ready_at: pool.pickup_at,
  });
  if (error) return { ok: false, error: error.message };

  // Same notification a flight match sends, and the payload is the pool either
  // way, so the bell needs nothing new. The joiner is not a recipient of their
  // own join and the rest are not the caller's session, hence service-role.
  if (existing?.length) {
    await serviceClient()
      .from("notifications")
      .insert(
        existing.map((m) => ({
          user_id: m.user_id,
          type: "ride_matched" as const,
          payload: { pool_id: poolId, joined_user_id: user.id },
        })),
      );
  }

  return { ok: true };
}

// No cutoff, unlike cancelling a flight, which locks the night before because
// somebody else's airport run depends on it. Backing out of a walk to dinner
// costs the group nothing but a seat.
export async function leaveHangout(poolId: string): Promise<Result> {
  const { user, supabase } = await requireUser();

  // rm_del is scoped to auth.uid() = user_id, so this can only ever remove the
  // caller no matter what poolId they pass.
  const { error } = await supabase
    .from("ride_members")
    .delete()
    .eq("pool_id", poolId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  const { data: remaining } = await supabase
    .from("ride_members")
    .select("user_id")
    .eq("pool_id", poolId);

  if (remaining?.length) {
    await serviceClient()
      .from("notifications")
      .insert(
        remaining.map((r) => ({
          user_id: r.user_id as string,
          type: "ride_member_left" as const,
          payload: { pool_id: poolId },
        })),
      );
  } else {
    // Last one out takes the hangout with them. Service-role for the same
    // reason as leavePool() in flights.ts: no client delete grant on
    // ride_pools, and the caller stopped being a member a few lines ago.
    await serviceClient().from("ride_pools").delete().eq("id", poolId);
  }

  return { ok: true };
}
