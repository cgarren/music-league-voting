import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackToHomeLink } from "@/components/BackToHomeLink";
import {
    getActiveSession,
    hasUserVotedInRound,
    type Phase,
} from "@/lib/session";
import { formatTopicDisplay } from "@/lib/formatTopicDisplay";
import { pluralize } from "@/lib/pluralize";
import {
    resultCardStyle,
    resultRankClass,
    voteBarStyle,
    voteBarWidthPercent,
    voteStrength,
} from "@/lib/resultsVisual";

type Row = {
    rank: number;
    topic_id: string;
    topic_text: string;
    submitter: string;
    total_points: number;
    voter_count: number;
};

const PHASE_COPY: Record<
    Exclude<Phase, "results">,
    {
        badge: string;
        headline: string;
        sub: string;
        cta?: { href: string; label: string };
    }
> = {
    setup: {
        badge: "Voting session being prepared",
        headline: "Results aren’t in yet",
        sub: "Topics are still being imported. Check back once Round 1 opens.",
    },
    submitting: {
        badge: "Submissions open",
        headline: "Results aren’t in yet",
        sub: "Topic submissions are currently open. Check back once voting starts.",
        cta: { href: "/submit", label: "Suggest topics" },
    },
    round1: {
        badge: "Round 1 in progress",
        headline: "Results aren’t in yet",
        sub: "Voters are picking their favorite topics. Results will post after Round 2 wraps.",
        cta: { href: "/vote/round1", label: "Cast your Round 1 ballot" },
    },
    round2: {
        badge: "Round 2 in progress",
        headline: "Almost there",
        sub: "Voters are ranking the Round 1 survivors. Ranked results go live the moment voting closes.",
        cta: { href: "/vote/round2", label: "Cast your Round 2 ballot" },
    },
    archived: {
        badge: "No active session",
        headline: "Nothing to show yet",
        sub: "The previous session has been archived. Check back for a new one soon.",
    },
};

export default async function ResultsPage() {
    const session = await getActiveSession();
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect("/");
    }

    if (!session || session.phase !== "results") {
        const phaseKey: keyof typeof PHASE_COPY = session
            ? (session.phase as keyof typeof PHASE_COPY)
            : "archived";
        const copy = PHASE_COPY[phaseKey];
        const voteRound: "round1" | "round2" | null =
            phaseKey === "round1" || phaseKey === "round2" ? phaseKey : null;
        const hasVoted =
            session && voteRound
                ? await hasUserVotedInRound(session.id, voteRound)
                : false;
        const ctaLabel =
            voteRound && hasVoted
                ? voteRound === "round1"
                    ? "Edit your Round 1 ballot"
                    : "Edit your Round 2 ballot"
                : copy.cta?.label;
        return (
            <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
                <span className="rounded-full border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 px-3 py-1 text-xs font-medium tracking-wide text-[color:var(--color-accent)]">
                    {copy.badge}
                </span>
                <h1 className="mt-6 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                    {copy.headline}
                </h1>
                <p className="mt-3 max-w-md text-pretty text-sm text-[color:var(--color-muted)]">
                    {copy.sub}
                </p>
                <div className="mt-8 flex flex-col items-center gap-3">
                    {copy.cta ? (
                        <Link
                            href={copy.cta.href}
                            className="inline-flex items-center justify-center rounded-full bg-[color:var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[color:var(--color-accent)]/30 transition-colors hover:bg-[color:var(--color-accent-strong)]"
                        >
                            {ctaLabel}
                        </Link>
                    ) : null}
                    <BackToHomeLink />
                </div>
            </div>
        );
    }

    const { data } = await supabase.rpc("get_results", {
        p_session_id: session.id,
    });
    const rows = (data ?? []) as Row[];
    const podiumSize = session.results_podium_count;
    const winners = rows.filter((r) => r.rank <= podiumSize);
    const runnersUp = rows.filter((r) => r.rank > podiumSize);
    const maxPoints = winners.reduce((m, r) => Math.max(m, r.total_points), 0);
    const minPoints = winners.reduce(
        (m, r) => Math.min(m, r.total_points),
        maxPoints,
    );

    return (
        <div className="mx-auto w-full max-w-2xl px-6 py-10">
            <header className="mb-8 text-center">
                <span className="rounded-full border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 px-3 py-1 text-xs font-medium tracking-wide text-[color:var(--color-accent)]">
                    Final results
                </span>
                <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight">
                    Topics for {session.name}
                </h1>
                <p className="mt-2 text-pretty text-sm text-[color:var(--color-muted)]">
                    Start thinking about wording and round order!
                </p>
            </header>

            {rows.length === 0 ? (
                <p className="text-center text-sm text-[color:var(--color-muted)]">
                    No results available.
                </p>
            ) : (
                <ol className="space-y-3">
                    {winners.map((r) => {
                        const strength = voteStrength(
                            r.total_points,
                            minPoints,
                            maxPoints,
                        );
                        const barW = voteBarWidthPercent(
                            r.total_points,
                            maxPoints,
                        );
                        return (
                            <li
                                key={r.topic_id}
                                style={resultCardStyle(strength)}
                                className="overflow-hidden rounded-xl border transition-[box-shadow,background-color] duration-200"
                            >
                                <div className="flex items-center gap-4 px-4 py-3">
                                    <span
                                        className={`flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-semibold ${resultRankClass(strength)}`}
                                    >
                                        {r.rank}
                                    </span>
                                    <div className="min-w-0 flex-1 text-left wrap-anywhere">
                                        <p className="text-pretty text-sm font-medium text-[color:var(--color-foreground)]">
                                            {formatTopicDisplay(r.topic_text)}
                                        </p>
                                        {r.submitter ? (
                                            <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                                                Submitted by {r.submitter}
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="shrink-0 text-right tabular-nums">
                                        <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
                                            {r.total_points}{" "}
                                            <span className="text-xs font-normal text-[color:var(--color-muted)]">
                                                {pluralize(
                                                    r.total_points,
                                                    "vote",
                                                    "votes",
                                                )}
                                            </span>
                                        </p>
                                        <p className="text-xs text-[color:var(--color-muted)]">
                                            {r.voter_count}{" "}
                                            {pluralize(
                                                r.voter_count,
                                                "voter",
                                                "voters",
                                            )}
                                        </p>
                                    </div>
                                </div>
                                <div
                                    className="flex h-1.5 w-full items-stretch border-t border-[color:var(--color-border)]/50 bg-[color:var(--color-surface-elevated)]/80"
                                    role="presentation"
                                    aria-hidden
                                >
                                    <div
                                        className="h-full min-w-0 origin-left rounded-r-full bg-[color:var(--color-accent)]"
                                        style={{
                                            width: `${barW}%`,
                                            ...voteBarStyle(strength),
                                        }}
                                    />
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}

            {runnersUp.length > 0 ? (
                <section className="mt-10">
                    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[color:var(--color-muted)]">
                        Runners up
                    </h2>
                    <ol className="divide-y divide-[color:var(--color-border)]/60 overflow-hidden rounded-xl border border-[color:var(--color-border)]/60 bg-[color:var(--color-surface)]/60">
                        {runnersUp.map((r) => (
                            <li
                                key={r.topic_id}
                                className="flex items-baseline gap-3 px-4 py-2.5"
                            >
                                <span className="w-6 shrink-0 text-right text-xs font-medium tabular-nums text-[color:var(--color-muted)]">
                                    {r.rank}
                                </span>
                                <div className="min-w-0 flex-1 wrap-anywhere">
                                    <p className="text-sm text-[color:var(--color-foreground)]">
                                        {formatTopicDisplay(r.topic_text)}
                                    </p>
                                    {r.submitter ? (
                                        <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                                            Submitted by {r.submitter}
                                        </p>
                                    ) : null}
                                </div>
                                <span className="shrink-0 text-xs tabular-nums text-[color:var(--color-muted)]">
                                    {r.total_points}{" "}
                                    {pluralize(
                                        r.total_points,
                                        "vote",
                                        "votes",
                                    )}
                                </span>
                            </li>
                        ))}
                    </ol>
                </section>
            ) : null}
        </div>
    );
}
