"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchAndParseSheet, sheetUrlSchema } from "@/lib/sheet";
import { rateLimit } from "@/lib/rate-limit";
import type { Phase } from "@/lib/session";

const LEGAL_TRANSITIONS: Record<Phase, Phase[]> = {
  setup: ["round1", "archived"],
  round1: ["round2", "setup", "archived"],
  round2: ["results", "round1", "archived"],
  results: ["archived"],
  archived: [],
};

async function guard(actionKey: string) {
  const admin = await requireAdmin();
  const limit = rateLimit(`admin:${admin.id}:${actionKey}`);
  if (!limit.allowed) {
    throw new Error(
      `Too many requests. Try again in ${Math.ceil((limit.retryAfterMs ?? 1000) / 1000)}s.`,
    );
  }
  return admin;
}

// -----------------------------------------------------------------------------
// Session lifecycle
// -----------------------------------------------------------------------------

const createSessionSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  sheet_url: sheetUrlSchema.optional().or(z.literal("").transform(() => undefined)),
});

export async function createSession(formData: FormData): Promise<void> {
  await guard("create_session");
  const parsed = createSessionSchema.parse({
    name: formData.get("name"),
    sheet_url: formData.get("sheet_url") || undefined,
  });

  const db = createAdminClient();
  // Reject if an active session already exists.
  const { data: existing } = await db
    .from("sessions")
    .select("id")
    .is("archived_at", null)
    .maybeSingle();
  if (existing) {
    throw new Error(
      "An active session already exists. Archive it before creating a new one.",
    );
  }

  const { error } = await db.from("sessions").insert({
    name: parsed.name,
    sheet_url: parsed.sheet_url ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function updateSheetUrl(formData: FormData): Promise<void> {
  await guard("update_sheet_url");
  const sheet_url = sheetUrlSchema.parse(formData.get("sheet_url"));
  const db = createAdminClient();
  const { data: session } = await db
    .from("sessions")
    .select("id, phase")
    .is("archived_at", null)
    .maybeSingle();
  if (!session) throw new Error("No active session.");
  if (session.phase !== "setup") {
    throw new Error("Sheet URL can only be changed while phase = setup.");
  }
  const { error } = await db
    .from("sessions")
    .update({ sheet_url })
    .eq("id", session.id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function transitionPhase(formData: FormData): Promise<void> {
  await guard("transition_phase");
  const to = z
    .enum(["setup", "round1", "round2", "results", "archived"])
    .parse(formData.get("to"));

  const db = createAdminClient();
  const { data: session, error: readErr } = await db
    .from("sessions")
    .select("id, phase")
    .is("archived_at", null)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!session) throw new Error("No active session.");
  const from = session.phase as Phase;
  if (!LEGAL_TRANSITIONS[from].includes(to)) {
    throw new Error(`Illegal phase transition: ${from} \u2192 ${to}`);
  }

  // Extra safety: don't open round 2 unless at least one round-1 vote exists.
  if (to === "round2") {
    const { count } = await db
      .from("round1_votes")
      .select("*", { count: "exact", head: true })
      .eq("session_id", session.id);
    if (!count || count === 0) {
      throw new Error(
        "Cannot open Round 2 \u2014 no Round 1 votes have been cast yet.",
      );
    }
  }

  const patch: { phase: Phase; archived_at?: string } = { phase: to };
  if (to === "archived") patch.archived_at = new Date().toISOString();

  const { error } = await db
    .from("sessions")
    .update(patch)
    .eq("id", session.id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/vote/round1");
  revalidatePath("/vote/round2");
  revalidatePath("/results");
}

// -----------------------------------------------------------------------------
// Topic import
// -----------------------------------------------------------------------------

const importPayloadSchema = z.object({
  session_id: z.string().uuid(),
  replace_existing: z.boolean().default(false),
  topics: z
    .array(
      z.object({
        topic: z.string().trim().min(1).max(500),
        submitter: z.string().trim().max(200).default(""),
      }),
    )
    .min(1)
    .max(500),
});

/**
 * Commits the admin-approved set of topics to the DB. Called from the admin
 * page after preview/dedupe. Expects topics already trimmed.
 */
export async function importTopics(payload: {
  session_id: string;
  replace_existing: boolean;
  topics: { topic: string; submitter: string }[];
}): Promise<{ inserted: number }> {
  await guard("import_topics");
  const parsed = importPayloadSchema.parse(payload);
  const db = createAdminClient();

  const { data: session } = await db
    .from("sessions")
    .select("id, phase")
    .eq("id", parsed.session_id)
    .maybeSingle();
  if (!session) throw new Error("Session not found.");
  if (session.phase !== "setup") {
    throw new Error("Topics can only be imported while phase = setup.");
  }

  if (parsed.replace_existing) {
    const { error } = await db
      .from("topics")
      .delete()
      .eq("session_id", parsed.session_id);
    if (error) throw new Error(error.message);
  }

  const rows = parsed.topics.map((t) => ({
    session_id: parsed.session_id,
    topic_text: t.topic,
    submitter: t.submitter,
    normalized_text: t.topic
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\p{L}\p{N} ]+/gu, "")
      .trim(),
  }));

  const { error, count } = await db
    .from("topics")
    .insert(rows, { count: "exact" });
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  return { inserted: count ?? rows.length };
}

/**
 * Server action invoked by the admin preview form. Fetches the sheet, returns
 * the parsed rows so the admin can review them client-side before calling
 * importTopics.
 */
export async function fetchSheetPreview(formData: FormData) {
  await guard("fetch_sheet_preview");
  const sheet_url = sheetUrlSchema.parse(formData.get("sheet_url"));
  const result = await fetchAndParseSheet(sheet_url);
  return result;
}

export async function removeTopic(formData: FormData): Promise<void> {
  await guard("remove_topic");
  const topic_id = z.string().uuid().parse(formData.get("topic_id"));
  const db = createAdminClient();
  const { error } = await db
    .from("topics")
    .update({ removed: true })
    .eq("id", topic_id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

// -----------------------------------------------------------------------------
// Manual (one-off) topic entry
// -----------------------------------------------------------------------------
// Same shape as a single row in `importPayloadSchema.topics`. Kept separate
// instead of reusing the batch schema because single-row entry has different
// error UX (we want to tell the admin exactly what's wrong with the one row).
const addManualTopicSchema = z.object({
  session_id: z.string().uuid(),
  topic: z.string().trim().min(1, "Topic is required.").max(500),
  submitter: z.string().trim().max(200).default(""),
});

function normalizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .trim();
}

/**
 * Inserts a single admin-entered topic. Same phase gate as `importTopics`
 * (setup only) and the same normalization so sheet-imported and hand-entered
 * topics can be de-duped consistently. Rejects duplicates of existing
 * non-removed topics in the session.
 */
export async function addManualTopic(payload: {
  session_id: string;
  topic: string;
  submitter: string;
}): Promise<{ ok: true }> {
  await guard("add_manual_topic");
  const parsed = addManualTopicSchema.parse(payload);
  const db = createAdminClient();

  const { data: session } = await db
    .from("sessions")
    .select("id, phase")
    .eq("id", parsed.session_id)
    .maybeSingle();
  if (!session) throw new Error("Session not found.");
  if (session.phase !== "setup") {
    throw new Error("Topics can only be added while phase = setup.");
  }

  const normalized_text = normalizeTopic(parsed.topic);
  if (!normalized_text) {
    throw new Error("Topic is empty after normalization.");
  }

  const { data: dup } = await db
    .from("topics")
    .select("id")
    .eq("session_id", parsed.session_id)
    .eq("normalized_text", normalized_text)
    .eq("removed", false)
    .maybeSingle();
  if (dup) {
    throw new Error("That topic already exists in this session.");
  }

  const { error } = await db.from("topics").insert({
    session_id: parsed.session_id,
    topic_text: parsed.topic,
    submitter: parsed.submitter,
    normalized_text,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  return { ok: true };
}
