import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
    getPublicSession,
    hasUserVotedInRound,
    type Phase,
} from "@/lib/session";
import { BrandMark } from "@/components/BrandMark";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

type PhaseCopy = {
    badge: string;
    loggedIn: { headline: string; sub: string };
    loggedOut: { headline: string; sub: string };
    cta?: { href: string; label: string };
};

const COPY: Record<Phase, PhaseCopy> = {
    setup: {
        badge: "Topics being imported",
        loggedIn: {
            headline: "The next round of topics is being prepared",
            sub: "Topic submissions are being gathered. Come back in a bit.",
        },
        loggedOut: {
            headline: "A new voting session is being prepared",
            sub: "Topics are being imported. Sign in with Google so you’re ready the moment Round 1 opens.",
        },
    },
    round1: {
        badge: "Round 1 open",
        loggedIn: {
            headline: "Vote now",
            sub: "Browse the submissions and pick three you would like to see this season.",
        },
        loggedOut: {
            headline: "Round 1 is in progress",
            sub: "Sign in with Google to cast your ballot — you’ll pick your 3 favorite topics.",
        },
        cta: { href: "/vote/round1", label: "Cast Round 1 ballot" },
    },
    round2: {
        badge: "Round 2 open",
        loggedIn: {
            headline: "Vote now",
            sub: "Only a few topics from Round 1 survived. Spend 10 votes however you like.",
        },
        loggedOut: {
            headline: "Round 2 is in progress",
            sub: "Sign in with Google to cast your ballot — you’ll distribute 10 votes across the finalists.",
        },
        cta: { href: "/vote/round2", label: "Cast Round 2 ballot" },
    },
    results: {
        badge: "Results",
        loggedIn: {
            headline: "The results are in",
            sub: "See the leading topics and who submitted them.",
        },
        loggedOut: {
            headline: "Results are in",
            sub: "Sign in with Google to see the leading topics and who submitted them.",
        },
        cta: { href: "/results", label: "View results" },
    },
    archived: {
        badge: "Archived",
        loggedIn: {
            headline: "This session has been archived",
            sub: "Sit tight \u2014 the admin will start a new round soon.",
        },
        loggedOut: {
            headline: "This session has been archived",
            sub: "Sit tight \u2014 the admin will start a new round soon.",
        },
    },
};

export default async function Home({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    const session = await getPublicSession();
    const params = await searchParams;
    const authError = params.auth_error === "1";
    const adminRequired = params.admin_required === "1";

    const voteRound: "round1" | "round2" | null =
        session?.phase === "round1" || session?.phase === "round2"
            ? session.phase
            : null;
    const hasVoted =
        user && session && voteRound
            ? await hasUserVotedInRound(session.id, voteRound)
            : false;

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
            {authError ? (
                <p className="mb-6 rounded-full border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 px-4 py-1.5 text-xs text-[color:var(--color-danger)]">
                    Sign-in failed. Try again.
                </p>
            ) : null}
            {adminRequired ? (
                <p className="mb-6 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-1.5 text-xs text-[color:var(--color-muted)]">
                    Admin only area.
                </p>
            ) : null}

            {!session ? (
                <>
                    <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-muted)]">
                        No active voting session
                    </span>
                    <h1 className="mt-6">
                        <BrandMark size="lg" />
                    </h1>
                    <p className="mt-4 max-w-lg text-base text-[color:var(--color-muted)]">
                        Vote to pick the next Music League topics. Come back
                        when the next season opens for voting.
                    </p>
                    {!user ? (
                        <div className="mt-10 flex flex-col items-center gap-2">
                            <GoogleSignInButton next="/" />
                            <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                                Are you an admin? Sign in to get the voting
                                process started.
                            </p>
                        </div>
                    ) : null}
                </>
            ) : (
                <>
                    <span className="rounded-full border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-accent)]">
                        {COPY[session.phase].badge}
                    </span>
                    <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
                        {
                            (user
                                ? COPY[session.phase].loggedIn
                                : COPY[session.phase].loggedOut
                            ).headline
                        }
                    </h1>
                    <p className="mt-4 max-w-xl text-base text-[color:var(--color-muted)]">
                        {
                            (user
                                ? COPY[session.phase].loggedIn
                                : COPY[session.phase].loggedOut
                            ).sub
                        }
                    </p>

                    <div className="mt-10">
                        {user ? (
                            COPY[session.phase].cta ? (
                                <Link
                                    href={COPY[session.phase].cta!.href}
                                    className="inline-flex items-center justify-center rounded-full bg-[color:var(--color-accent)] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[color:var(--color-accent)]/30 transition-colors hover:bg-[color:var(--color-accent-strong)]"
                                >
                                    {voteRound && hasVoted
                                        ? voteRound === "round1"
                                            ? "Edit your Round 1 ballot"
                                            : "Edit your Round 2 ballot"
                                        : COPY[session.phase].cta!.label}
                                </Link>
                            ) : null
                        ) : (
                            <div className="flex flex-col items-center gap-2">
                                <GoogleSignInButton next="/" />
                                <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                                    We only use your Google email to ensure one
                                    vote per person.
                                </p>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
