"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// ----------------------- Round 1 ---------------------------------------------

// Round 1 ballots are always exactly 3 distinct topics. Fewer than 3 is an
// incomplete ballot and wouldn't give the user any benefit (they'd just lose
// picks). The frontend enforces this too; this is the server-side gate.
const ROUND1_REQUIRED_PICKS = 3;

const round1PayloadSchema = z.object({
  session_id: z.string().uuid(),
  topic_ids: z
    .array(z.string().uuid())
    .refine(
      (ids) => new Set(ids).size === ROUND1_REQUIRED_PICKS,
      `Round 1 ballot must contain exactly ${ROUND1_REQUIRED_PICKS} distinct topics.`,
    ),
});

/**
 * Replaces the caller's Round 1 ballot with exactly 3 distinct topic ids.
 * RLS + ballot-cap trigger provide defense in depth on the upper bound; we
 * also delete the user's old rows first so re-submits are idempotent.
 */
export async function submitRound1Ballot(payload: {
  session_id: string;
  topic_ids: string[];
}): Promise<{ ok: true }> {
  const parsed = round1PayloadSchema.parse(payload);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in.");

  const uniqueIds = Array.from(new Set(parsed.topic_ids));

  const { error: delError } = await supabase
    .from("round1_votes")
    .delete()
    .eq("user_id", user.id)
    .eq("session_id", parsed.session_id);
  if (delError) throw new Error(delError.message);

  const rows = uniqueIds.map((topic_id) => ({
    user_id: user.id,
    topic_id,
    session_id: parsed.session_id,
  }));
  const { error } = await supabase.from("round1_votes").insert(rows);
  if (error) throw new Error(error.message);

  revalidatePath("/vote/round1");
  revalidatePath("/");
  return { ok: true };
}

// ----------------------- Round 2 ---------------------------------------------

// Round 2 ballots must assign exactly 10 votes total. Partial ballots are
// rejected for the same reason we reject Round 1's <3 picks: voters giving up
// unspent votes would only dilute their own influence. The DB trigger caps
// the upper bound at 10; this schema enforces the lower bound too.
const ROUND2_REQUIRED_VOTES = 10;

const round2PayloadSchema = z.object({
  session_id: z.string().uuid(),
  allocations: z
    .array(
      z.object({
        topic_id: z.string().uuid(),
        weight: z.number().int().min(0).max(ROUND2_REQUIRED_VOTES),
      }),
    )
    .max(500)
    .refine(
      (allocs) =>
        allocs.reduce((s, a) => s + a.weight, 0) === ROUND2_REQUIRED_VOTES,
      `Round 2 ballot must assign exactly ${ROUND2_REQUIRED_VOTES} votes.`,
    ),
});

/**
 * Replaces the caller's Round 2 allocations. Expects a full ballot
 * (topic_id + weight for every changed topic). Zero-weight entries are
 * deleted. Total vote weight must equal exactly 10 (enforced in app +
 * trigger caps the upper bound).
 */
export async function submitRound2Ballot(payload: {
  session_id: string;
  allocations: { topic_id: string; weight: number }[];
}): Promise<{ ok: true }> {
  const parsed = round2PayloadSchema.parse(payload);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in.");

  // Simplest reliable approach given trigger-enforced caps: wipe then insert.
  const { error: delError } = await supabase
    .from("round2_votes")
    .delete()
    .eq("user_id", user.id)
    .eq("session_id", parsed.session_id);
  if (delError) throw new Error(delError.message);

  const nonZero = parsed.allocations.filter((a) => a.weight > 0);
  if (nonZero.length > 0) {
    const rows = nonZero.map((a) => ({
      user_id: user.id,
      topic_id: a.topic_id,
      session_id: parsed.session_id,
      weight: a.weight,
    }));
    const { error } = await supabase.from("round2_votes").insert(rows);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/vote/round2");
  revalidatePath("/");
  return { ok: true };
}
