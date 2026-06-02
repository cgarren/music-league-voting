import Link from "next/link";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getAdminUser, isAdminConfigured } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/server";
import { PHASE_LABEL, type Phase } from "@/lib/session";
import { pluralize } from "@/lib/pluralize";
import { RESULTS_RUNNERS_UP_COUNT } from "@/lib/resultsDisplayConfig";
import { formatTopicDisplay } from "@/lib/formatTopicDisplay";
import { LiveResults, type LiveResultsRow } from "../../LiveResults";
import { VoterRollup, type VoterRow } from "../../VoterRollup";
import { DeleteSessionButton } from "./DeleteSessionButton";

type AdminTopic = {
  id: string;
  topic_text: string;
  submitter: string;
  removed: boolean;
};

type SessionStats = {
  topic_count: number | null;
  r1_voter_count: number | null;
  r1_ballot_count: number | null;
  r2_voter_count: number | null;
  r2_ballot_count: number | null;
};

const PHASE_COPY: Record<Phase, string> = {
  setup: "Setup — import & clean topics",
  round1: "Round 1 — voters picking top 3",
  round2: "Round 2 — voters spending 10 votes",
  results: "Results — published to voters",
  archived: "Archived",
};

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isAdminConfigured()) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Admin unavailable</h1>
        <p className="mt-2 text-[color:var(--color-muted)]">
          No admin emails are configured. Set the <code>ADMIN_EMAILS</code>{" "}
          environment variable to a comma-separated list of admin addresses and
          redeploy.
        </p>
      </div>
    );
  }

  const admin = await getAdminUser();
  if (!admin) redirect("/?admin_required=1");

  const { id } = await params;
  const db = createAdminClient();

  // Fetch the specific session
  const { data: session } = await db
    .from("sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!session) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <Link
          href="/admin/history"
          className="text-sm text-[color:var(--color-muted)] hover:text-[color:var(--color-accent)] hover:underline inline-flex items-center gap-1 mb-4"
        >
          &larr; Back to Session History
        </Link>
        <h1 className="text-2xl font-semibold">Session not found</h1>
        <p className="mt-2 text-[color:var(--color-muted)]">
          The requested session ID does not exist.
        </p>
      </div>
    );
  }

  const topics: AdminTopic[] = (
    await db
      .from("topics")
      .select("id, topic_text, submitter, removed, created_at")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true })
  ).data ?? [];

  const visibleTopics = topics.filter((t) => !t.removed);

  const stats: SessionStats | null =
    ((
      await db
        .from("v_session_stats")
        .select(
          "topic_count, r1_voter_count, r1_ballot_count, r2_voter_count, r2_ballot_count",
        )
        .eq("session_id", session.id)
        .maybeSingle()
    ).data as SessionStats | null) ?? null;

  const { data: listing } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const byId = new Map(listing?.users?.map((u) => [u.id, u]) ?? []);

  // Determine which voting results/rollups to show based on the historic session phase
  const VOTING_PHASES: readonly Phase[] = ["round1", "round2", "results", "archived"];
  const showVotingData = VOTING_PHASES.includes(session.phase);
  
  const round1Rows: LiveResultsRow[] = showVotingData
    ? await fetchRound1Tallies(db, session.id, visibleTopics)
    : [];

  const showR2 = ["round2", "results", "archived"].includes(session.phase);
  const round2Rows: LiveResultsRow[] = showR2
    ? await fetchRound2Tallies(db, session.id, visibleTopics)
    : [];

  const voters: VoterRow[] = showVotingData
    ? await fetchVoterRollup(db, session.id, byId)
    : [];

  const r2VoteTotal = round2Rows.reduce((s, r) => s + r.value, 0);

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isActive = session.archived_at === null;

  const r1ResultsEl = showVotingData ? (
    <LiveResults
      title="Round 1 — voting results"
      caption="Total picks made per topic during Round 1. Each voter had 3 picks."
      rows={round1Rows}
      unitSingular="pick made"
      unitPlural="picks made"
      accentVar="--color-accent"
      emptyMessage="No Round 1 picks were cast."
    />
  ) : null;

  const r2ResultsEl = showR2 ? (
    <LiveResults
      title="Round 2 — voting results"
      caption={`Total votes per topic across all Round 2 ballots. Voters saw the ${pluralize(
        session.results_podium_count,
        "leading topic",
        "leading topics",
      )} plus ${RESULTS_RUNNERS_UP_COUNT} runners up.`}
      rows={round2Rows}
      unitSingular="vote"
      unitPlural="votes"
      accentVar="--color-success"
      emptyMessage="No Round 2 votes were cast."
    />
  ) : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-6">
        <Link
          href="/admin/history"
          className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-accent)] hover:underline inline-flex items-center gap-1 mb-2"
        >
          &larr; Back to Session History
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{session.name}</h1>
            <p className="mt-1 text-sm text-[color:var(--color-muted)]">
              Read-only view of a past voting session
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={
                isActive
                  ? "rounded-full border border-[color:var(--color-success)]/40 bg-[color:var(--color-success)]/10 px-3 py-1 text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-success)]"
                  : "rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-1 text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-muted)]"
              }
            >
              {isActive ? "Active" : "Archived"}
            </span>
            {isActive && (
              <span className="rounded-full border border-[color:var(--color-accent)]/30 bg-[color:var(--color-accent)]/5 px-3 py-1 text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-accent)]">
                {PHASE_LABEL[session.phase as Phase] || session.phase}
              </span>
            )}
            {!isActive && (
              <DeleteSessionButton sessionId={session.id} sessionName={session.name} />
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* Core Session Info */}
        <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
          <h2 className="text-lg font-semibold mb-4">Session Info</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="block text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
                Phase Status
              </span>
              <span className="mt-1 block font-medium">
                {PHASE_COPY[session.phase as Phase] || session.phase}
              </span>
            </div>
            <div>
              <span className="block text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
                Google Sheet URL
              </span>
              {session.sheet_url ? (
                <a
                  href={session.sheet_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block font-medium text-[color:var(--color-accent)] hover:underline truncate"
                >
                  {session.sheet_url}
                </a>
              ) : (
                <span className="mt-1 block text-[color:var(--color-muted)] italic">
                  None provided
                </span>
              )}
            </div>
            <div>
              <span className="block text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
                Created At
              </span>
              <span className="mt-1 block font-medium">
                {formatDateTime(session.created_at)}
              </span>
            </div>
            <div>
              <span className="block text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
                Archived At
              </span>
              <span className="mt-1 block font-medium">
                {formatDateTime(session.archived_at)}
              </span>
            </div>
          </div>

          {stats ? (
            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Topics" value={stats.topic_count} />
              <Stat
                label="R1 voters"
                value={stats.r1_voter_count}
                sub={
                  stats.r1_ballot_count != null
                    ? `${stats.r1_ballot_count} ${pluralize(
                        stats.r1_ballot_count,
                        "pick",
                        "picks",
                      )}`
                    : undefined
                }
              />
              <Stat
                label="R2 voters"
                value={stats.r2_voter_count}
                sub={`${r2VoteTotal} ${pluralize(r2VoteTotal, "vote", "votes")} cast`}
              />
            </dl>
          ) : null}
        </section>

        {/* Configuration Details */}
        <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
          <h2 className="text-lg font-semibold mb-4">Configuration</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="block text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
                Podium Size
              </span>
              <span className="mt-1 block font-medium">
                {session.results_podium_count} topics
                <span className="block text-xs font-normal text-[color:var(--color-muted)]">
                  plus {RESULTS_RUNNERS_UP_COUNT} runners up
                </span>
              </span>
            </div>
            <div>
              <span className="block text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
                Target Time Zone
              </span>
              <span className="mt-1 block font-medium">
                {session.deadline_timezone || "UTC"}
              </span>
            </div>
          </div>

          {(session.round1_deadline_at || session.round2_deadline_at) && (
            <div className="mt-6 border-t border-[color:var(--color-border)] pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="block text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
                  Round 1 Deadline
                </span>
                <span className="mt-1 block font-medium">
                  {formatDateTime(session.round1_deadline_at)}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase tracking-wider text-[color:var(--color-muted)]">
                  Round 2 Deadline
                </span>
                <span className="mt-1 block font-medium">
                  {formatDateTime(session.round2_deadline_at)}
                </span>
              </div>
            </div>
          )}
        </section>

        {/* Voting Results & Voter Rollups */}
        {r2ResultsEl}
        {r1ResultsEl}

        {showVotingData && voters.length > 0 && (
          <VoterRollup voters={voters} />
        )}

        {/* Topic List */}
        <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h3 className="text-base font-semibold">Topics</h3>
            <p className="text-xs text-[color:var(--color-muted)]">
              {visibleTopics.length} active topic{visibleTopics.length === 1 ? "" : "s"}
              {topics.length > visibleTopics.length &&
                ` (${topics.length - visibleTopics.length} removed)`}
            </p>
          </div>
          {topics.length === 0 ? (
            <p className="text-sm text-[color:var(--color-muted)] italic text-center py-4">
              No topics were imported or suggested in this session.
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto pr-1">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--color-border)] text-xs font-semibold uppercase tracking-wider text-[color:var(--color-muted)]">
                    <th className="py-2 pr-4 font-medium">Topic Text</th>
                    <th className="py-2 px-4 font-medium">Submitter</th>
                    <th className="py-2 pl-4 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--color-border)]">
                  {topics.map((t) => (
                    <tr
                      key={t.id}
                      className="hover:bg-[color:var(--color-surface-elevated)]/40 transition-colors"
                    >
                      <td className="py-3 pr-4 font-medium min-w-0 wrap-anywhere">
                        {formatTopicDisplay(t.topic_text)}
                      </td>
                      <td className="py-3 px-4 text-[color:var(--color-muted)]">
                        {t.submitter || "Imported"}
                      </td>
                      <td className="py-3 pl-4 text-right">
                        {t.removed ? (
                          <span className="text-xs text-[color:var(--color-danger)] font-medium bg-[color:var(--color-danger)]/10 border border-[color:var(--color-danger)]/20 px-2 py-0.5 rounded-full">
                            Removed
                          </span>
                        ) : (
                          <span className="text-xs text-[color:var(--color-success)] font-medium bg-[color:var(--color-success)]/10 border border-[color:var(--color-success)]/20 px-2 py-0.5 rounded-full">
                            Active
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | null;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">
        {value ?? 0}
      </dd>
      {sub ? (
        <p className="mt-0.5 text-[11px] text-[color:var(--color-muted)]">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

// --- Data loaders copied from admin dashboard page.tsx ---

type AdminDb = ReturnType<typeof createAdminClient>;

async function fetchRound1Tallies(
  db: AdminDb,
  sessionId: string,
  topics: AdminTopic[],
): Promise<LiveResultsRow[]> {
  const { data } = await db
    .from("round1_votes")
    .select("topic_id")
    .eq("session_id", sessionId);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.topic_id, (counts.get(row.topic_id) ?? 0) + 1);
  }
  return topics.map((t) => ({
    topic_id: t.id,
    topic_text: t.topic_text,
    submitter: t.submitter || null,
    value: counts.get(t.id) ?? 0,
  }));
}

async function fetchRound2Tallies(
  db: AdminDb,
  sessionId: string,
  topics: AdminTopic[],
): Promise<LiveResultsRow[]> {
  // Round 2 only operates on Round 1 survivors — topics that received at
  // least one Round 1 vote. Pull those IDs first so the chart doesn't list
  // topics that can't possibly accrue Round 2 votes.
  const { data: r1 } = await db
    .from("round1_votes")
    .select("topic_id")
    .eq("session_id", sessionId);
  const survivorIds = new Set<string>();
  for (const row of r1 ?? []) survivorIds.add(row.topic_id);

  const { data: r2 } = await db
    .from("round2_votes")
    .select("topic_id, weight")
    .eq("session_id", sessionId);
  const r2TotalsByTopic = new Map<string, number>();
  for (const row of r2 ?? []) {
    r2TotalsByTopic.set(
      row.topic_id,
      (r2TotalsByTopic.get(row.topic_id) ?? 0) + row.weight,
    );
  }

  return topics
    .filter((t) => survivorIds.has(t.id))
    .map((t) => ({
      topic_id: t.id,
      topic_text: t.topic_text,
      submitter: t.submitter || null,
      value: r2TotalsByTopic.get(t.id) ?? 0,
    }));
}

async function fetchVoterRollup(
  db: AdminDb,
  sessionId: string,
  byId: Map<string, User>,
): Promise<VoterRow[]> {
  const [{ data: r1 }, { data: r2 }] = await Promise.all([
    db.from("round1_votes").select("user_id").eq("session_id", sessionId),
    db
      .from("round2_votes")
      .select("user_id, weight")
      .eq("session_id", sessionId),
  ]);

  const r1Picks = new Map<string, number>();
  for (const row of r1 ?? []) {
    r1Picks.set(row.user_id, (r1Picks.get(row.user_id) ?? 0) + 1);
  }
  const r2VotesByUser = new Map<string, number>();
  for (const row of r2 ?? []) {
    r2VotesByUser.set(
      row.user_id,
      (r2VotesByUser.get(row.user_id) ?? 0) + row.weight,
    );
  }

  const voterIds = new Set<string>([...r1Picks.keys(), ...r2VotesByUser.keys()]);
  if (voterIds.size === 0) return [];

  const rows: VoterRow[] = [];
  for (const id of voterIds) {
    const user = byId.get(id);
    rows.push({
      user_id: id,
      name: resolveName(user),
      email: user?.email ?? "—",
      r1_picks: r1Picks.get(id) ?? 0,
      r2_votes: r2VotesByUser.get(id) ?? 0,
    });
  }
  return rows;
}

function resolveName(
  user: { email?: string; user_metadata?: Record<string, unknown> } | undefined,
): string {
  if (!user) return "Unknown voter";
  const meta = user.user_metadata ?? {};
  const full =
    typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  if (full) return full;
  const name = typeof meta.name === "string" ? meta.name.trim() : "";
  if (name) return name;
  if (user.email) return user.email.split("@")[0];
  return "Unknown voter";
}
