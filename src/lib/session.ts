import { createClient } from "@/lib/supabase/server";

export type Phase = "setup" | "round1" | "round2" | "results" | "archived";

/** Human-readable session phase (UI copy, not the DB enum string). */
export const PHASE_LABEL: Record<Phase, string> = {
  setup: "Setup",
  round1: "Round 1",
  round2: "Round 2",
  results: "Results",
  archived: "Archived",
};

export type ActiveSession = {
  id: string;
  name: string;
  sheet_url: string | null;
  phase: Phase;
  created_at: string;
  // Optional admin-set target deadlines for each voting round. Informational
  // only — voting is closed manually via a phase transition, not by these
  // timestamps. Null when the admin hasn't set (or has cleared) the deadline.
  round1_deadline_at: string | null;
  round2_deadline_at: string | null;
  // Optional IANA timezone label used as the "original timezone" reference
  // when comparing against the voter's local browser timezone.
  deadline_timezone: string | null;
};

export type PublicSession = Omit<
  ActiveSession,
  "sheet_url" | "round1_deadline_at" | "round2_deadline_at" | "deadline_timezone"
>;

/**
 * Returns the currently active (non-archived) session, or null if no session
 * has been created yet. Uses the caller's Supabase client so RLS still
 * applies — `sessions` is readable to `authenticated`, so this requires a
 * signed-in caller. Use `getPublicSession()` for the logged-out landing page.
 */
export async function getActiveSession(): Promise<ActiveSession | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sessions")
    .select(
      "id, name, sheet_url, phase, created_at, round1_deadline_at, round2_deadline_at, deadline_timezone",
    )
    .is("archived_at", null)
    .maybeSingle();
  return (data as ActiveSession | null) ?? null;
}

/**
 * Returns the active session in a form safe for unauthenticated callers:
 * omits `sheet_url`. Backed by a SECURITY DEFINER RPC so the anon role can
 * read the phase without needing a blanket grant on `sessions`.
 */
export async function getPublicSession(): Promise<PublicSession | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_session");
  const rows = (data ?? []) as PublicSession[];
  return rows[0] ?? null;
}

/**
 * Returns true if the signed-in user already has at least one saved vote for
 * the given round of the given session. Used to swap CTA copy from "Cast your
 * ballot" to "Edit your ballot" on landing / results pages.
 *
 * Relies on RLS: each user can only read their own vote rows, so this can't
 * be abused to probe someone else's ballot.
 */
export async function hasUserVotedInRound(
  sessionId: string,
  round: "round1" | "round2",
): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const table = round === "round1" ? "round1_votes" : "round2_votes";
  const { count } = await supabase
    .from(table)
    .select("topic_id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("user_id", user.id);
  return (count ?? 0) > 0;
}
