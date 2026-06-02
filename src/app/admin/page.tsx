import { redirect } from "next/navigation";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { getAdminUser, isAdminConfigured } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveSession, type Phase } from "@/lib/session";
import { pluralize } from "@/lib/pluralize";
import { RESULTS_RUNNERS_UP_COUNT } from "@/lib/resultsDisplayConfig";
import {
  createSession,
  transitionPhase,
  updateResultsPodiumCount,
  updateSheetUrl,
  updateSubmissionCap,
  deleteSubmission,
  promoteSubmissions,
} from "@/app/actions/admin";
import { formatTopicDisplay } from "@/lib/formatTopicDisplay";
import { AdminImport } from "./AdminImport";
import { DeadlineEditor } from "./DeadlineEditor";
import { LiveResults, type LiveResultsRow } from "./LiveResults";
import { TopicEditor } from "./TopicEditor";
import { VoterRollup, type VoterRow } from "./VoterRollup";

// Admin-side shape of a topic row from the `topics` table. AdminImport owns
// the Setup-phase editing UI, so outside of Setup the admin surface just uses
// this type for the live-results / voter-rollup loaders.
type AdminTopic = {
  id: string;
  topic_text: string;
  submitter: string;
  removed: boolean;
};

const PHASE_COPY: Record<Phase, string> = {
  setup: "Setup — import & clean topics",
  submitting: "Submissions — gathering user suggestions",
  round1: "Round 1 — voters picking top 3",
  round2: "Round 2 — voters spending 10 votes",
  results: "Results — published to voters",
  archived: "Archived",
};

// Order: secondary / “back” actions first, primary advance last (right side).
const NEXT_ACTIONS: Record<Phase, { to: Phase; label: string }[]> = {
  setup: [
    { to: "submitting", label: "Open Submissions Phase" },
    { to: "round1", label: "Skip to Round 1" },
  ],
  submitting: [
    { to: "setup", label: "Back to Setup" },
    { to: "round1", label: "Start Round 1 (No Promotion)" },
  ],
  round1: [
    { to: "setup", label: "Reopen Setup" },
    { to: "submitting", label: "Reopen Submissions" },
    { to: "round2", label: "Close Round 1 → Open Round 2" },
  ],
  round2: [
    { to: "round1", label: "Reopen Round 1" },
    { to: "results", label: "Close Round 2 → Publish Results" },
  ],
  results: [
    { to: "round2", label: "Reopen Round 2" },
    { to: "archived", label: "Archive & Start Fresh" },
  ],
  archived: [],
};

// Phases where voters have been doing something worth surfacing on the admin
// dashboard (live tallies + voter rollup). Setup is pre-voting; archived is
// post-everything and intentionally minimal.
const VOTING_PHASES: readonly Phase[] = ["round1", "round2", "results"];

type SessionStats = {
  topic_count: number | null;
  r1_voter_count: number | null;
  r1_ballot_count: number | null;
  r2_voter_count: number | null;
  r2_ballot_count: number | null;
};

export default async function AdminPage() {
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

  const session = await getActiveSession();
  const db = createAdminClient();

  const topics: AdminTopic[] = session
    ? (
        await db
          .from("topics")
          .select("id, topic_text, submitter, removed, created_at")
          .eq("session_id", session.id)
          .order("created_at", { ascending: true })
      ).data ?? []
    : [];
  const visibleTopics = topics.filter((t) => !t.removed);

  const stats: SessionStats | null = session
    ? ((
        await db
          .from("v_session_stats")
          .select(
            "topic_count, r1_voter_count, r1_ballot_count, r2_voter_count, r2_ballot_count",
          )
          .eq("session_id", session.id)
          .maybeSingle()
      ).data as SessionStats | null) ?? null
    : null;

  // Fetch submissions and user directory if applicable
  const submissions = session && session.phase === "submitting"
    ? (
        await db
          .from("submissions")
          .select("id, topic_text, user_id, created_at")
          .eq("session_id", session.id)
          .order("created_at", { ascending: false })
      ).data ?? []
    : [];

  const { data: listing } = session
    ? await db.auth.admin.listUsers({ page: 1, perPage: 200 })
    : { data: null };
  const byId = new Map(listing?.users?.map((u) => [u.id, u]) ?? []);

  // Live tallies and voter rollup are only meaningful once voters are active.
  const showVotingData = session && VOTING_PHASES.includes(session.phase);
  const round1Rows: LiveResultsRow[] = showVotingData
    ? await fetchRound1Tallies(db, session.id, visibleTopics)
    : [];
  const showR2 = session && ["round2", "results"].includes(session.phase);
  const showTopicEditor = session && ["setup", "submitting", "round1", "round2"].includes(session.phase);
  const round2Rows: LiveResultsRow[] = showR2
    ? await fetchRound2Tallies(db, session.id, visibleTopics)
    : [];
  const voters: VoterRow[] = showVotingData
    ? await fetchVoterRollup(db, session.id, byId)
    : [];
  const r2VoteTotal = round2Rows.reduce((s, r) => s + r.value, 0);

  const r1ResultsEl = showVotingData ? (
    <LiveResults
      title={
        session && session.phase === "round1"
          ? "Round 1 — live results"
          : "Round 1 — final results"
      }
      caption={
        session && session.phase === "round1"
          ? "Updated every reload. Each voter makes 3 picks; only topics with ≥ 1 pick move on to Round 2."
          : "Final Round 1 results (sorted by picks made per topic)."
      }
      rows={round1Rows}
      unitSingular="pick made"
      unitPlural="picks made"
      accentVar="--color-accent"
      emptyMessage="No Round 1 picks made yet."
    />
  ) : null;

  const r2ResultsEl = showR2 && session ? (
    <LiveResults
      title={
        session.phase === "round2" ? "Round 2 — live results" : "Round 2 — final results"
      }
      caption={
        session.phase === "round2"
          ? "Total votes per topic across all Round 2 ballots. Each voter has 10 votes to spend."
          : `Final vote totals per topic (voters see the ${pluralize(
              session.results_podium_count,
              "leading topic",
              "leading topics",
            )} you set plus ${RESULTS_RUNNERS_UP_COUNT} runners up).`
      }
      rows={round2Rows}
      unitSingular="vote"
      unitPlural="votes"
      accentVar="--color-success"
      emptyMessage="No Round 2 votes yet."
    />
  ) : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            Signed in as {admin.email}
          </p>
        </div>
      </div>

      {!session ? (
        <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
          <h2 className="text-lg font-semibold">Start a new session</h2>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            Give this round of voting a name. You can paste the Google Sheet
            URL now or add it below once the session is created.
          </p>
          <form action={createSession} className="mt-4 flex flex-col gap-3">
            <label className="text-sm font-medium">
              Name
              <input
                required
                name="name"
                type="text"
                placeholder="Week of May 5th"
                className="mt-1 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm focus:border-[color:var(--color-accent)] focus:outline-none"
              />
            </label>
            <label className="text-sm font-medium">
              Google Sheet URL (optional)
              <input
                name="sheet_url"
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="mt-1 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm focus:border-[color:var(--color-accent)] focus:outline-none"
              />
            </label>
            <label className="text-sm font-medium">
              Leading topics on results page
              <input
                name="results_podium_count"
                type="number"
                min={1}
                max={50}
                defaultValue={12}
                className="mt-1 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm tabular-nums focus:border-[color:var(--color-accent)] focus:outline-none"
              />
              <span className="mt-1 block text-xs font-normal text-[color:var(--color-muted)]">
                Between 1 and 50. Voters also see the next {RESULTS_RUNNERS_UP_COUNT}{" "}
                runners up. You can change this later in admin.
              </span>
            </label>
            <button
              type="submit"
              className="self-start rounded-full bg-[color:var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[color:var(--color-accent-strong)]"
            >
              Create session
            </button>
          </form>
        </section>
      ) : (
        <div className="flex flex-col gap-6">
          <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{session.name}</h2>
                <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                  Current phase:{" "}
                  <span className="font-medium text-[color:var(--color-foreground)]">
                    {PHASE_COPY[session.phase]}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {NEXT_ACTIONS[session.phase].map((action, i, arr) => {
                  const isPrimary = i === arr.length - 1;
                  return (
                    <form key={action.to} action={transitionPhase}>
                      <input type="hidden" name="to" value={action.to} />
                      <button
                        type="submit"
                        className={
                          isPrimary
                            ? "rounded-full bg-[color:var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[color:var(--color-accent-strong)]"
                            : "rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-4 py-2 text-sm font-medium hover:border-[color:var(--color-accent)]"
                        }
                      >
                        {action.label}
                      </button>
                    </form>
                  );
                })}
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
                          "pick made",
                          "picks made",
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

          <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold">Round deadlines</h3>
              <p className="text-xs text-[color:var(--color-muted)]">
                Optional. Shown to voters as a target — voting still closes
                only when you advance the phase.
              </p>
            </div>
            <DeadlineEditor
              round1DeadlineAt={session.round1_deadline_at}
              round2DeadlineAt={session.round2_deadline_at}
              deadlineTimezone={session.deadline_timezone}
            />
          </section>

          <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold">Results page layout</h3>
              <p className="text-xs text-[color:var(--color-muted)]">
                Shown when you publish results. Runners up: next {RESULTS_RUNNERS_UP_COUNT}{" "}
                topics after this many leading entries.
              </p>
            </div>
            <form
              action={updateResultsPodiumCount}
              className="mt-4 flex flex-wrap items-end gap-3"
            >
              <label className="text-sm font-medium">
                Leading topics (1–50)
                <input
                  name="results_podium_count"
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={session.results_podium_count}
                  required
                  className="mt-1 block w-32 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm tabular-nums focus:border-[color:var(--color-accent)] focus:outline-none"
                />
              </label>
              <button
                type="submit"
                className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-4 py-2 text-sm hover:border-[color:var(--color-accent)]"
              >
                Save
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold">User Submission Cap</h3>
              <p className="text-xs text-[color:var(--color-muted)]">
                Limits the number of suggestions a user can submit. Leave blank or set to 0 for unlimited.
              </p>
            </div>
            <form
              action={updateSubmissionCap}
              className="mt-4 flex flex-wrap items-end gap-3"
            >
              <label className="text-sm font-medium">
                Max submissions per user
                <input
                  name="submission_cap"
                  type="number"
                  min={1}
                  defaultValue={session.submission_cap ?? ""}
                  placeholder="Unlimited"
                  className="mt-1 block w-32 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm tabular-nums focus:border-[color:var(--color-accent)] focus:outline-none"
                />
              </label>
              <button
                type="submit"
                className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-4 py-2 text-sm hover:border-[color:var(--color-accent)]"
              >
                Save Cap
              </button>
            </form>
          </section>

          {session.phase === "setup" ? (
            <>
              <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
                <h3 className="text-base font-semibold">Google Sheet</h3>
                <form
                  action={updateSheetUrl}
                  className="mt-3 flex flex-col gap-2 sm:flex-row"
                >
                  <input
                    required
                    name="sheet_url"
                    type="url"
                    defaultValue={session.sheet_url ?? ""}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="flex-1 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm focus:border-[color:var(--color-accent)] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm hover:border-[color:var(--color-accent)]"
                  >
                    Save URL
                  </button>
                </form>
                <p className="mt-2 text-xs text-[color:var(--color-muted)]">
                  Sheet must be shared as &quot;Anyone with the link (Viewer)&quot;.
                  We only fetch from docs.google.com.
                </p>
              </section>

              <AdminImport
                sessionId={session.id}
                sheetUrl={session.sheet_url}
                existingTopics={visibleTopics.map((t) => ({
                  id: t.id,
                  topic_text: t.topic_text,
                  submitter: t.submitter,
                }))}
              />
            </>
          ) : session.phase === "submitting" ? (
            <>
              <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--color-border)] pb-4 mb-4">
                  <div>
                    <h3 className="text-base font-semibold">Topic Submissions Moderation</h3>
                    <p className="text-xs text-[color:var(--color-muted)]">
                      Review and delete suggestions before importing. Click &quot;Import &amp; Start Round 1&quot; when ready.
                    </p>
                  </div>
                  <form action={promoteSubmissions}>
                    <button
                      type="submit"
                      disabled={submissions.length === 0}
                      className="rounded-full bg-[color:var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[color:var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Import Submissions &amp; Start Round 1
                    </button>
                  </form>
                </div>

                <div className="text-sm text-[color:var(--color-muted)] mb-4">
                  {submissions.length} {pluralize(submissions.length, "submission", "submissions")} received.
                </div>

                {submissions.length === 0 ? (
                  <p className="text-sm text-[color:var(--color-muted)] italic">
                    Waiting for users to submit topics...
                  </p>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto pr-1">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[color:var(--color-border)] text-xs font-semibold uppercase tracking-wider text-[color:var(--color-muted)]">
                          <th className="py-2">Topic Text</th>
                          <th className="py-2">Submitter</th>
                          <th className="py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[color:var(--color-border)] text-sm">
                        {submissions.map((sub) => {
                          const user = byId.get(sub.user_id);
                          const name = resolveName(user);
                          return (
                            <tr key={sub.id} className="hover:bg-[color:var(--color-surface-elevated)]/40">
                              <td className="py-3 pr-4 font-medium">{formatTopicDisplay(sub.topic_text)}</td>
                              <td className="py-3 text-[color:var(--color-muted)]">{name} ({user?.email ?? "—"})</td>
                              <td className="py-3 text-right">
                                <form action={deleteSubmission} className="inline">
                                  <input type="hidden" name="id" value={sub.id} />
                                  <button
                                    type="submit"
                                    className="text-xs text-[color:var(--color-danger)] hover:underline"
                                  >
                                    Delete
                                  </button>
                                </form>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : (
            <>
              {["round2", "results"].includes(session.phase) ? (
                <>
                  {r2ResultsEl}
                  {r1ResultsEl}
                </>
              ) : (
                <>
                  {r1ResultsEl}
                  {r2ResultsEl}
                </>
              )}

              {showVotingData ? <VoterRollup voters={voters} /> : null}
            </>
          )}

          {showTopicEditor ? (
            <TopicEditor
              topics={visibleTopics.map((t) => ({
                id: t.id,
                topic_text: t.topic_text,
                submitter: t.submitter,
              }))}
              sessionId={session.id}
              canAddTopic={["setup", "round1", "round2"].includes(session.phase)}
              defaultOpen={session.phase === "setup"}
            />
          ) : null}
        </div>
      )}
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

// --- Data loaders ----------------------------------------------------------

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
