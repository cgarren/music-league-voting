"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

// ----------------------- Round 1 ---------------------------------------------

// Round 1 ballots total exactly 3 distinct picks. The picks may be any
// combination of (a) topics from the imported list and (b) one user-submitted
// topic typed into the ballot's textarea. The actual ballot composition,
// dedupe, and topic creation all happen inside the SECURITY DEFINER RPC
// `submit_round1_ballot` so that the topic insert and the vote inserts share
// a single transaction. This zod schema is purely a shape/sanity gate;
// the authoritative count check lives in the RPC.
const ROUND1_REQUIRED_PICKS = 3;

const round1PayloadSchema = z.object({
  session_id: z.string().uuid(),
  topic_ids: z.array(z.string().uuid()).max(ROUND1_REQUIRED_PICKS),
  user_topic_text: z
    .string()
    .max(500)
    .nullable()
    .optional()
    .transform((v) => {
      if (v == null) return null;
      const trimmed = v.trim();
      return trimmed.length === 0 ? null : trimmed;
    }),
});

/**
 * Replaces the caller's Round 1 ballot with exactly 3 distinct topics.
 * Optionally accepts a `user_topic_text` — if provided, a topic owned by the
 * caller is upserted and counts as one of the 3 picks. The DB trigger
 * `enforce_round1_cap` is still defense in depth; the RPC enforces phase,
 * dedupe, ballot count, and topic-membership in a single transaction.
 */
export async function submitRound1Ballot(payload: {
  session_id: string;
  topic_ids: string[];
  user_topic_text?: string | null;
}): Promise<{ ok: true }> {
  const parsed = round1PayloadSchema.parse(payload);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in.");

  // Cheap per-user throttle. The user-topic path lets a signed-in voter
  // create rows in `topics`, so we don't want a runaway loop here even
  // though the RPC already dedupes against the user's own existing row.
  const limit = rateLimit(`r1_submit:${user.id}`, {
    capacity: 30,
    refillPerMinute: 30,
  });
  if (!limit.allowed) {
    throw new Error(
      `Too many ballot saves. Try again in ${Math.ceil((limit.retryAfterMs ?? 1000) / 1000)}s.`,
    );
  }

  const { error } = await supabase.rpc("submit_round1_ballot", {
    p_session_id: parsed.session_id,
    p_topic_ids: parsed.topic_ids,
    p_user_topic_text: parsed.user_topic_text,
  });
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
