"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { normalizeTopic } from "@/lib/normalize";

const submitTopicSchema = z.object({
  topic: z
    .string()
    .trim()
    .min(1, "Topic is required.")
    .max(100, "Topic cannot exceed 100 characters."),
});

export async function submitTopic(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Please sign in.");
  }

  // Rate limit by user ID
  const limit = rateLimit(`submit:${user.id}`);
  if (!limit.allowed) {
    throw new Error(
      `Too many requests. Try again in ${Math.ceil(
        (limit.retryAfterMs ?? 1000) / 1000,
      )}s.`,
    );
  }

  const topicInput = formData.get("topic");
  const parsed = submitTopicSchema.parse({ topic: topicInput });
  const normalized_text = normalizeTopic(parsed.topic);

  if (!normalized_text) {
    throw new Error("Topic is empty after normalization.");
  }

  // Get active session
  const { data: session } = await supabase
    .from("sessions")
    .select("id, phase, submission_cap")
    .is("archived_at", null)
    .maybeSingle();

  if (!session) {
    throw new Error("No active session.");
  }

  if (session.phase !== "submitting") {
    throw new Error("Topic submissions are closed.");
  }

  // Enforce submission cap if configured (non-null and positive)
  if (session.submission_cap !== null && session.submission_cap > 0) {
    const { count } = await supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("session_id", session.id)
      .eq("user_id", user.id);

    if ((count ?? 0) >= session.submission_cap) {
      throw new Error(
        `You have reached the submission limit of ${session.submission_cap} topics.`,
      );
    }
  }

  // Check if this specific user already submitted this topic (normalized match)
  const { data: dup } = await supabase
    .from("submissions")
    .select("id")
    .eq("session_id", session.id)
    .eq("user_id", user.id)
    .eq("normalized_text", normalized_text)
    .maybeSingle();

  if (dup) {
    throw new Error("You have already submitted this topic suggestion.");
  }

  // Insert submission
  const { error } = await supabase.from("submissions").insert({
    session_id: session.id,
    user_id: user.id,
    topic_text: parsed.topic,
    normalized_text,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/submit");
  revalidatePath("/");
}
