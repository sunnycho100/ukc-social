"use server";

import { requireUser } from "@/lib/supabase/server";
import { getConference } from "@/lib/conference";
import { serviceClient } from "@/lib/supabase/service";
import { type Direction, type FlightInput } from "@/lib/rides";

type Result = { ok: boolean; error?: string };

export async function submitFlight(input: FlightInput): Promise<Result> {
  const { user, supabase } = await requireUser();
  if (!input.localDateTime) return { ok: false, error: "Add your flight time." };

  const conference = await getConference(supabase);
  const utcOffset = conference?.utc_offset ?? "-04:00";
  const scheduledAt = new Date(`${input.localDateTime}:00${utcOffset}`);
  if (isNaN(scheduledAt.getTime())) return { ok: false, error: "That time didn't parse." };

  const { data: flight, error } = await supabase
    .from("flights")
    .upsert(
      {
        user_id: user.id,
        direction: input.direction,
        airport: conference?.airport_code ?? "",
        scheduled_at: scheduledAt.toISOString(),
        luggage: true,
      },
      { onConflict: "user_id,direction" },
    )
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  // Open (or reuse) this flight's ride pool and seat the poster in it, so
  // "Share" on Rides has something real to join — see migration 0011.
  const { data: pool, error: poolErr } = await supabase
    .from("ride_pools")
    .upsert(
      {
        anchor_flight_id: flight.id,
        direction: input.direction,
        pickup_at: scheduledAt.toISOString(),
      },
      { onConflict: "anchor_flight_id" },
    )
    .select("id")
    .single();
  if (poolErr) return { ok: false, error: poolErr.message };

  const { error: memberErr } = await supabase.from("ride_members").upsert(
    {
      pool_id: pool.id,
      user_id: user.id,
      ready_at: scheduledAt.toISOString(),
    },
    { onConflict: "pool_id,user_id", ignoreDuplicates: true },
  );
  if (memberErr) return { ok: false, error: memberErr.message };

  return { ok: true };
}

export async function deleteFlight(direction: Direction): Promise<Result> {
  const { user, supabase } = await requireUser();
  const { error } = await supabase
    .from("flights")
    .delete()
    .eq("user_id", user.id)
    .eq("direction", direction);
  if (error) return { ok: false, error: error.message };
  return { ok: true }; // cascades: ride_pools.anchor_flight_id -> ride_members
}

// "Share" on Rides — joins the target flight's ride pool. Capped at the
// pool's capacity (default 4, ride_pools.capacity from 0001); once full,
// callers should stop offering the join action.
export async function joinRide(flightId: string): Promise<Result & { full?: boolean }> {
  const { user, supabase } = await requireUser();

  const { data: pool, error: poolErr } = await supabase
    .from("ride_pools")
    .select("id, capacity")
    .eq("anchor_flight_id", flightId)
    .maybeSingle();
  if (poolErr) return { ok: false, error: poolErr.message };
  if (!pool) return { ok: false, error: "This ride isn't open yet." };

  const { data: existing, error: countErr } = await supabase
    .from("ride_members")
    .select("user_id")
    .eq("pool_id", pool.id);
  if (countErr) return { ok: false, error: countErr.message };
  const count = existing?.length ?? 0;
  if (count >= pool.capacity) return { ok: false, error: "This ride is full.", full: true };

  const { error } = await supabase.from("ride_members").upsert(
    { pool_id: pool.id, user_id: user.id, ready_at: new Date().toISOString() },
    { onConflict: "pool_id,user_id", ignoreDuplicates: true },
  );
  if (error) return { ok: false, error: error.message };

  // Notify every rider already in the pool (they gained a rider) — the joiner
  // isn't one of the recipients, and most of them aren't the caller's own
  // session, so this needs the service-role client.
  const others = (existing ?? []).filter((m) => m.user_id !== user.id);
  if (others.length) {
    await serviceClient()
      .from("notifications")
      .insert(
        others.map((m) => ({
          user_id: m.user_id,
          type: "ride_matched" as const,
          payload: { pool_id: pool.id, joined_user_id: user.id },
        })),
      );
  }

  return { ok: true, full: count + 1 >= pool.capacity };
}
