"use client";

import { useState, useTransition, useMemo } from "react";
import { submitRound1Ballot } from "@/app/actions/vote";
import { DeadlineNotice } from "@/components/DeadlineNotice";
import { formatTopicDisplay } from "@/lib/formatTopicDisplay";
import { findSimilarItems } from "@/lib/similarity";

type Topic = {
    id: string;
    topic_text: string;
};

type UserTopic = {
    id: string;
    topic_text: string;
} | null;

const REQUIRED_PICKS = 3;
const USER_TOPIC_MAX_LEN = 500;

export function Round1Ballot({
    sessionId,
    topics,
    selected: initialSelected,
    userTopic,
    deadlineAt,
    deadlineTimezone,
}: {
    sessionId: string;
    topics: Topic[];
    selected: string[];
    userTopic: UserTopic;
    deadlineAt: string | null;
    deadlineTimezone: string | null;
}) {
    const initialUserText = userTopic?.topic_text ?? "";
    const [selected, setSelected] = useState<Set<string>>(
        () => new Set(initialSelected),
    );
    const [savedSelection, setSavedSelection] = useState<Set<string>>(
        () => new Set(initialSelected),
    );
    const [userText, setUserText] = useState(initialUserText);
    const [savedUserText, setSavedUserText] = useState(initialUserText);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const [justSaved, setJustSaved] = useState(false);

    // The textarea acts like a checkbox toggled by content: non-empty trim ⇒
    // selected. We always derive from `userText` so the UI can never
    // disagree with the count we send to the server.
    const userTopicActive = userText.trim().length > 0;
    const totalPicks = selected.size + (userTopicActive ? 1 : 0);

    const similarTopics = useMemo(() => {
        if (pending) return [];
        return findSimilarItems(
            userText,
            topics,
            (t) => t.topic_text,
            0.55
        );
    }, [userText, topics, pending]);

    const toggle = (id: string) => {
        setError(null);
        setJustSaved(false);
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleUserTextChange = (next: string) => {
        setError(null);
        setJustSaved(false);
        // Hard cap by length here as well as on the server so the textarea
        // doesn't accept input that would be rejected on save.
        const clipped = next.slice(0, USER_TOPIC_MAX_LEN);
        setUserText(clipped);
    };

    const isDirty =
        !setsEqual(selected, savedSelection) ||
        userText.trim() !== savedUserText.trim();
    const isComplete = totalPicks === REQUIRED_PICKS;
    const remainingUnder = REQUIRED_PICKS - totalPicks;
    const extraOver =
        totalPicks > REQUIRED_PICKS ? totalPicks - REQUIRED_PICKS : 0;

    const handleSubmit = () => {
        setError(null);
        const trimmedUserText = userText.trim();
        startTransition(async () => {
            try {
                await submitRound1Ballot({
                    session_id: sessionId,
                    topic_ids: Array.from(selected),
                    user_topic_text: trimmedUserText || null,
                });
                setSavedSelection(new Set(selected));
                setSavedUserText(trimmedUserText);
                setUserText(trimmedUserText);
                setJustSaved(true);
            } catch (e) {
                setError((e as Error).message);
            }
        });
    };

    // When at the cap with no user-topic, lock the textarea so the user can't
    // type their way past the limit. To suggest a topic they need to free up
    // a list slot first. (Conversely if the textarea is already non-empty,
    // we leave it editable so they can fix typos / clear it.)
    const userTopicLocked = !userTopicActive && selected.size >= REQUIRED_PICKS;

    return (
        <div className="mx-auto w-full max-w-2xl px-6 py-10">
            <header className="mb-6">
                <span className="rounded-full border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 px-3 py-1 text-xs font-medium tracking-wide text-[color:var(--color-accent)]">
                    Round 1
                </span>
                <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight">
                    Pick your {REQUIRED_PICKS} favorite topics
                </h1>
                <p className="mt-2 text-pretty text-sm text-[color:var(--color-muted)]">
                    Tap topics as you browse; you can choose more than{" "}
                    {REQUIRED_PICKS} and narrow down anytime. Saving is enabled
                    only when exactly {REQUIRED_PICKS} &nbsp;picks remain
                    (including your suggestion if you use it). Topics with at
                    least one vote move on to Round 2.
                </p>
                <DeadlineNotice
                    deadline={deadlineAt}
                    roundLabel="Round 1"
                    originalTimezone={deadlineTimezone}
                />
            </header>

            <div className="sticky top-0 z-10 -mx-6 mb-4 flex items-center justify-between border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]/90 px-6 py-3 backdrop-blur">
                <p className="text-sm tabular-nums">
                    {extraOver > 0 ? (
                        <>
                            <span className="font-semibold">{totalPicks}</span>
                            <span className="text-[color:var(--color-muted)]">
                                {" "}
                                picks (need exactly {REQUIRED_PICKS} to save ·
                                remove {extraOver} extra
                                {extraOver === 1 ? "" : "s"})
                            </span>
                        </>
                    ) : (
                        <>
                            <span className="font-semibold">{totalPicks}</span>
                            <span className="text-[color:var(--color-muted)]">
                                {" "}
                                / {REQUIRED_PICKS} picks
                            </span>
                            {!isComplete ? (
                                <span className="ml-2 text-xs text-[color:var(--color-muted)]">
                                    ({`Pick ${remainingUnder} more`})
                                </span>
                            ) : (
                                <span className="ml-2 text-xs text-[color:var(--color-success)]">
                                    (Ready to save)
                                </span>
                            )}
                        </>
                    )}
                </p>
                <div className="flex items-center gap-3">
                    {justSaved && !isDirty ? (
                        <span className="text-xs text-[color:var(--color-success)]">
                            Ballot saved
                        </span>
                    ) : null}
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={pending || !isDirty || !isComplete}
                        title={
                            !isComplete
                                ? extraOver > 0
                                    ? `You have ${extraOver} too many ${extraOver === 1 ? "pick" : "picks"}—remove extras until exactly ${REQUIRED_PICKS} remain.`
                                    : `Pick ${remainingUnder} more topic${remainingUnder === 1 ? "" : "s"} to save your ballot.`
                                : undefined
                        }
                        className="rounded-full bg-[color:var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[color:var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {pending
                            ? "Saving…"
                            : isDirty
                              ? "Save ballot"
                              : "Saved"}
                    </button>
                </div>
            </div>

            {error ? (
                <p className="mb-4 rounded-lg border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 px-3 py-2 text-sm text-[color:var(--color-danger)]">
                    {error}
                </p>
            ) : null}

            <ul className="space-y-2">
                {topics.map((t) => {
                    const isSelected = selected.has(t.id);
                    return (
                        <li key={t.id}>
                            <button
                                type="button"
                                onClick={() => toggle(t.id)}
                                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                                    isSelected
                                        ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10"
                                        : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:border-[color:var(--color-accent)]/60"
                                }`}
                            >
                                <div className="flex items-start gap-3">
                                    <CheckBox checked={isSelected} />
                                    {/* min-w-0 + wrap-anywhere so a single
                                        very long word (legal in
                                        user-submitted topics) wraps inside
                                        the card instead of pushing past it. */}
                                    <div className="min-w-0 flex-1 wrap-anywhere">
                                        <p className="text-sm font-medium text-pretty">
                                            {formatTopicDisplay(t.topic_text)}
                                        </p>
                                    </div>
                                </div>
                            </button>
                        </li>
                    );
                })}

                <li>
                    <div
                        className={`w-full rounded-xl border px-4 py-3 transition-colors ${
                            userTopicActive
                                ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10"
                                : "border-dashed border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
                        } ${userTopicLocked ? "opacity-50" : ""}`}
                    >
                        <div className="flex items-start gap-3">
                            <CheckBox checked={userTopicActive} />
                            <div className="min-w-0 flex-1">
                                {/* <label
                                    htmlFor="user-topic"
                                    className="block text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-muted)]"
                                >
                                    Suggest your own topic
                                </label> */}
                                <textarea
                                    id="user-topic"
                                    value={userText}
                                    onChange={(e) =>
                                        handleUserTextChange(e.target.value)
                                    }
                                    disabled={userTopicLocked}
                                    rows={1}
                                    maxLength={USER_TOPIC_MAX_LEN}
                                    placeholder={
                                        userTopicLocked
                                            ? "Uncheck a topic above to add your own."
                                            : "Your topic here…"
                                    }
                                    className="mt-0 w-full resize-y bg-transparent text-sm font-medium text-pretty outline-none placeholder:font-normal placeholder:text-[color:var(--color-muted)] disabled:cursor-not-allowed"
                                />
                                <p className="mt-0 text-[11px] text-[color:var(--color-muted)]">
                                    {userTopicActive
                                        ? "Counts as 1 of your 3 picks. Editable until Round 1 closes."
                                        : "If filled in, this counts as 1 of your 3 picks."}
                                </p>

                                {similarTopics.length > 0 && (
                                    <div className="mt-3 rounded-lg border border-[color:var(--color-accent)]/20 bg-[color:var(--color-background)] p-3 text-xs animate-slide-up flex flex-col gap-2 shadow-sm">
                                        <span className="font-semibold text-[color:var(--color-accent)] flex items-center gap-1.5">
                                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                            {similarTopics.length === 1 ? "Already exists on the ballot:" : `${similarTopics.length} options already exist on the ballot:`}
                                        </span>
                                        <ul className="space-y-1.5">
                                            {similarTopics.slice(0, 3).map((match) => (
                                                <li key={match.item.id} className="flex items-center justify-between gap-2">
                                                    <span className="font-medium text-[color:var(--color-foreground)] break-words">
                                                        {formatTopicDisplay(match.item.topic_text)}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSelected((prev) => {
                                                                const next = new Set(prev);
                                                                next.add(match.item.id);
                                                                return next;
                                                            });
                                                            setUserText("");
                                                            setError(null);
                                                            setJustSaved(false);
                                                        }}
                                                        className="flex-none rounded-full bg-[color:var(--color-accent)]/15 px-2.5 py-1 text-[10px] font-semibold text-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/25 transition-colors border border-[color:var(--color-accent)]/20"
                                                    >
                                                        Vote for this instead
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </li>
            </ul>
        </div>
    );
}

function CheckBox({ checked }: { checked: boolean }) {
    return (
        <span
            className={`mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-md border ${
                checked
                    ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white"
                    : "border-[color:var(--color-border)]"
            }`}
            aria-hidden
        >
            {checked ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                        d="M2 6.5l2.5 2.5L10 3"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            ) : null}
        </span>
    );
}

function setsEqual(a: Set<string>, b: Set<string>) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}
