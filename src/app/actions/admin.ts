"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchAndParseSheet, sheetUrlSchema } from "@/lib/sheet";
import { rateLimit } from "@/lib/rate-limit";
import { parseDeadlineForStorage } from "@/lib/parseDeadlineForStorage";
import type { Phase } from "@/lib/session";
import { normalizeTopic } from "@/lib/normalize";

const LEGAL_TRANSITIONS: Record<Phase, Phase[]> = {
  setup: ["submitting", "round1", "archived"],
  submitting: ["round1", "setup", "archived"],
  round1: ["round2", "submitting", "archived"],
  round2: ["results", "round1", "archived"],
  results: ["round2", "archived"],
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
  results_podium_count: z.preprocess(
    (v) => (v === "" || v == null ? 12 : v),
    z.coerce.number().int().min(1).max(50),
  ),
});

export async function createSession(formData: FormData): Promise<void> {
  await guard("create_session");
  const parsed = createSessionSchema.parse({
    name: formData.get("name"),
    sheet_url: formData.get("sheet_url") || undefined,
    results_podium_count: formData.get("results_podium_count"),
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
    results_podium_count: parsed.results_podium_count,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/");
}

const updateResultsPodiumSchema = z.object({
  results_podium_count: z.coerce
    .number()
    .int()
    .min(1, "Use a number from 1 to 50.")
    .max(50, "Use a number from 1 to 50."),
});

/** How many leading topics appear on `/results`; runners up count is fixed in SQL. */
export async function updateResultsPodiumCount(
  formData: FormData,
): Promise<void> {
  await guard("update_results_podium");
  const parsed = updateResultsPodiumSchema.parse({
    results_podium_count: formData.get("results_podium_count"),
  });
  const db = createAdminClient();
  const { data: session } = await db
    .from("sessions")
    .select("id")
    .is("archived_at", null)
    .maybeSingle();
  if (!session) throw new Error("No active session.");
  const { error } = await db
    .from("sessions")
    .update({ results_podium_count: parsed.results_podium_count })
    .eq("id", session.id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/results");
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

// -----------------------------------------------------------------------------
// Round deadlines (informational)
// -----------------------------------------------------------------------------
// Admin can set, change, or clear an optional target deadline for each voting
// round. These values are *purely informational* — they're shown to voters
// and admins but do not close voting. Only `transitionPhase` closes a round.
//
// Deadlines: the admin UI sends UTC ISO from the browser (see DeadlineEditor)
// so server actions running in UTC do not reinterpret naive datetime strings.
// Naive `YYYY-MM-DDTHH:mm` is still accepted and interpreted in
// `deadline_timezone` (Original deadline timezone) as a fallback.
const rawDeadlineSchema = z.union([z.literal(""), z.string().min(1)]);

const updateDeadlinesSchema = z.object({
  round1_deadline_at: rawDeadlineSchema,
  round2_deadline_at: rawDeadlineSchema,
  deadline_timezone: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => {
      const tz = v?.trim() ?? "";
      if (!tz) return null;
      // Validate IANA timezone IDs (e.g. "America/New_York").
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
      } catch {
        throw new Error("Invalid time zone.");
      }
      return tz;
    }),
});

export async function updateRoundDeadlines(formData: FormData): Promise<void> {
  await guard("update_round_deadlines");
  const parsed = updateDeadlinesSchema.parse({
    round1_deadline_at: (formData.get("round1_deadline_at") ?? "") as string,
    round2_deadline_at: (formData.get("round2_deadline_at") ?? "") as string,
    deadline_timezone: (formData.get("deadline_timezone") ?? "") as string,
  });

  const tz = parsed.deadline_timezone;
  const round1_deadline_at = parseDeadlineForStorage(parsed.round1_deadline_at, tz);
  const round2_deadline_at = parseDeadlineForStorage(parsed.round2_deadline_at, tz);

  const db = createAdminClient();
  const { data: session } = await db
    .from("sessions")
    .select("id")
    .is("archived_at", null)
    .maybeSingle();
  if (!session) throw new Error("No active session.");

  const { error } = await db
    .from("sessions")
    .update({
      round1_deadline_at,
      round2_deadline_at,
      deadline_timezone: tz,
    })
    .eq("id", session.id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePath("/vote/round1");
  revalidatePath("/vote/round2");
  revalidatePath("/");
}

export async function transitionPhase(formData: FormData): Promise<void> {
  await guard("transition_phase");
  const to = z
    .enum(["setup", "submitting", "round1", "round2", "results", "archived"])
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
    normalized_text: normalizeTopic(t.topic),
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
  const session = await getEditableTopicSession(db);
  const topicIds = [topic_id];

  const [{ error: r1Err }, { error: r2Err }] = await Promise.all([
    db
      .from("round1_votes")
      .delete()
      .eq("session_id", session.id)
      .in("topic_id", topicIds),
    db
      .from("round2_votes")
      .delete()
      .eq("session_id", session.id)
      .in("topic_id", topicIds),
  ]);
  if (r1Err) throw new Error(r1Err.message);
  if (r2Err) throw new Error(r2Err.message);

  const { error } = await db
    .from("topics")
    .update({ removed: true })
    .eq("id", topic_id)
    .eq("session_id", session.id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/vote/round1");
  revalidatePath("/vote/round2");
  revalidatePath("/results");
}

const removeTopicsSchema = z.object({
  topic_ids: z.array(z.string().uuid()).min(1).max(500),
});

export async function removeTopics(payload: {
  topic_ids: string[];
}): Promise<{ removed: number }> {
  await guard("remove_topics");
  const parsed = removeTopicsSchema.parse(payload);
  const db = createAdminClient();
  const session = await getEditableTopicSession(db);
  const uniqueIds = [...new Set(parsed.topic_ids)];

  const [{ error: r1Err }, { error: r2Err }] = await Promise.all([
    db
      .from("round1_votes")
      .delete()
      .eq("session_id", session.id)
      .in("topic_id", uniqueIds),
    db
      .from("round2_votes")
      .delete()
      .eq("session_id", session.id)
      .in("topic_id", uniqueIds),
  ]);
  if (r1Err) throw new Error(r1Err.message);
  if (r2Err) throw new Error(r2Err.message);

  const { error, count } = await db
    .from("topics")
    .update({ removed: true }, { count: "exact" })
    .eq("session_id", session.id)
    .in("id", uniqueIds)
    .eq("removed", false);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePath("/vote/round1");
  revalidatePath("/vote/round2");
  revalidatePath("/results");
  return { removed: count ?? 0 };
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


type AdminDb = ReturnType<typeof createAdminClient>;

async function getEditableTopicSession(db: AdminDb): Promise<{
  id: string;
  phase: Phase;
}> {
  const { data: session } = await db
    .from("sessions")
    .select("id, phase")
    .is("archived_at", null)
    .maybeSingle();
  if (!session) throw new Error("No active session.");
  if (!["setup", "submitting", "round1", "round2"].includes(session.phase)) {
    throw new Error(
      "Topic editing is only available during setup, submissions, round 1, or round 2.",
    );
  }
  return { id: session.id, phase: session.phase as Phase };
}

const updateTopicSchema = z.object({
  topic_id: z.string().uuid(),
  topic: z.string().trim().min(1, "Topic is required.").max(500),
  submitter: z.string().trim().max(200).default(""),
});

export async function updateTopic(payload: {
  topic_id: string;
  topic: string;
  submitter: string;
}): Promise<{ ok: true }> {
  await guard("update_topic");
  const parsed = updateTopicSchema.parse(payload);
  const db = createAdminClient();
  const session = await getEditableTopicSession(db);
  const normalized_text = normalizeTopic(parsed.topic);
  if (!normalized_text) {
    throw new Error("Topic is empty after normalization.");
  }

  const { data: current } = await db
    .from("topics")
    .select("id")
    .eq("id", parsed.topic_id)
    .eq("session_id", session.id)
    .eq("removed", false)
    .maybeSingle();
  if (!current) throw new Error("Topic not found.");

  const { data: dup } = await db
    .from("topics")
    .select("id")
    .eq("session_id", session.id)
    .eq("normalized_text", normalized_text)
    .eq("removed", false)
    .neq("id", parsed.topic_id)
    .maybeSingle();
  if (dup) {
    throw new Error("That topic already exists in this session.");
  }

  const { error } = await db
    .from("topics")
    .update({
      topic_text: parsed.topic,
      submitter: parsed.submitter,
      normalized_text,
    })
    .eq("id", parsed.topic_id)
    .eq("session_id", session.id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePath("/vote/round1");
  revalidatePath("/vote/round2");
  revalidatePath("/results");
  return { ok: true };
}

const mergeTopicsSchema = z.object({
  source_topic_id: z.string().uuid(),
  target_topic_id: z.string().uuid(),
});

export async function mergeTopics(payload: {
  source_topic_id: string;
  target_topic_id: string;
}): Promise<{ ok: true }> {
  await guard("merge_topics");
  const parsed = mergeTopicsSchema.parse(payload);
  if (parsed.source_topic_id === parsed.target_topic_id) {
    throw new Error("Choose two different topics to merge.");
  }

  const db = createAdminClient();
  const session = await getEditableTopicSession(db);

  const { data: topics } = await db
    .from("topics")
    .select("id")
    .eq("session_id", session.id)
    .in("id", [parsed.source_topic_id, parsed.target_topic_id])
    .eq("removed", false);
  if (!topics || topics.length !== 2) {
    throw new Error("Both topics must exist in the active session.");
  }

  const [{ data: r1Source }, { data: r1Target }] = await Promise.all([
    db
      .from("round1_votes")
      .select("user_id")
      .eq("session_id", session.id)
      .eq("topic_id", parsed.source_topic_id),
    db
      .from("round1_votes")
      .select("user_id")
      .eq("session_id", session.id)
      .eq("topic_id", parsed.target_topic_id),
  ]);
  const r1TargetUsers = new Set((r1Target ?? []).map((row) => row.user_id));
  const r1ToInsert = (r1Source ?? [])
    .filter((row) => !r1TargetUsers.has(row.user_id))
    .map((row) => ({
      user_id: row.user_id,
      topic_id: parsed.target_topic_id,
      session_id: session.id,
    }));

  const { error: r1DeleteErr } = await db
    .from("round1_votes")
    .delete()
    .eq("session_id", session.id)
    .eq("topic_id", parsed.source_topic_id);
  if (r1DeleteErr) throw new Error(r1DeleteErr.message);
  if (r1ToInsert.length > 0) {
    const { error: r1InsertErr } = await db.from("round1_votes").insert(r1ToInsert);
    if (r1InsertErr) throw new Error(r1InsertErr.message);
  }

  const [{ data: r2Source }, { data: r2Target }] = await Promise.all([
    db
      .from("round2_votes")
      .select("user_id, weight")
      .eq("session_id", session.id)
      .eq("topic_id", parsed.source_topic_id),
    db
      .from("round2_votes")
      .select("user_id, weight")
      .eq("session_id", session.id)
      .eq("topic_id", parsed.target_topic_id),
  ]);
  const r2ByUser = new Map<string, number>();
  for (const row of r2Target ?? []) r2ByUser.set(row.user_id, row.weight);
  for (const row of r2Source ?? []) {
    r2ByUser.set(row.user_id, (r2ByUser.get(row.user_id) ?? 0) + row.weight);
  }

  const { error: r2DeleteErr } = await db
    .from("round2_votes")
    .delete()
    .eq("session_id", session.id)
    .eq("topic_id", parsed.source_topic_id);
  if (r2DeleteErr) throw new Error(r2DeleteErr.message);

  const r2Upserts = (r2Source ?? []).map((row) => ({
    user_id: row.user_id,
    topic_id: parsed.target_topic_id,
    session_id: session.id,
    weight: r2ByUser.get(row.user_id) ?? row.weight,
  }));
  if (r2Upserts.length > 0) {
    const { error: r2UpsertErr } = await db
      .from("round2_votes")
      .upsert(r2Upserts, { onConflict: "user_id,topic_id" });
    if (r2UpsertErr) throw new Error(r2UpsertErr.message);
  }

  const { error: topicErr } = await db
    .from("topics")
    .update({ removed: true })
    .eq("id", parsed.source_topic_id)
    .eq("session_id", session.id);
  if (topicErr) throw new Error(topicErr.message);

  revalidatePath("/admin");
  revalidatePath("/vote/round1");
  revalidatePath("/vote/round2");
  revalidatePath("/results");
  return { ok: true };
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
  if (!["setup", "submitting", "round1", "round2"].includes(session.phase)) {
    throw new Error(
      "Topics can only be added while phase = setup, submitting, round1, or round2.",
    );
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

// -----------------------------------------------------------------------------
// Submissions administration
// -----------------------------------------------------------------------------

const updateSubmissionCapSchema = z.object({
  submission_cap: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.coerce.number().int().min(1, "Cap must be at least 1.").nullable()
  ),
});

export async function updateSubmissionCap(formData: FormData): Promise<void> {
  await guard("update_submission_cap");
  const parsed = updateSubmissionCapSchema.parse({
    submission_cap: formData.get("submission_cap"),
  });

  const db = createAdminClient();
  const { data: session } = await db
    .from("sessions")
    .select("id")
    .is("archived_at", null)
    .maybeSingle();
  if (!session) throw new Error("No active session.");

  const { error } = await db
    .from("sessions")
    .update({ submission_cap: parsed.submission_cap })
    .eq("id", session.id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePath("/submit");
}

export async function deleteSubmission(formData: FormData): Promise<void> {
  await guard("delete_submission");
  const id = z.string().uuid().parse(formData.get("id"));
  const db = createAdminClient();
  const { error } = await db
    .from("submissions")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePath("/submit");
}

export async function promoteSubmissions(_formData: FormData): Promise<void> {
  void _formData;
  await guard("promote_submissions");
  const db = createAdminClient();
  const { data: session } = await db
    .from("sessions")
    .select("id, phase")
    .is("archived_at", null)
    .maybeSingle();
  if (!session) throw new Error("No active session.");
  if (session.phase !== "submitting") {
    throw new Error("Session is not in submitting phase.");
  }

  // Call the DB RPC function to promote submissions to topics
  const { error: rpcErr } = await db
    .rpc("promote_submissions", { p_session_id: session.id });
  if (rpcErr) throw new Error(rpcErr.message);

  revalidatePath("/admin");
  revalidatePath("/submit");
  revalidatePath("/vote/round1");
  revalidatePath("/");
}
export async function deleteSession(formData: FormData): Promise<void> {
  await guard("delete_session");
  const id = z.string().uuid().parse(formData.get("id"));
  const db = createAdminClient();

  const { error } = await db
    .from("sessions")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/history");
  revalidatePath("/admin");
  revalidatePath("/");
  redirect("/admin/history");
}
