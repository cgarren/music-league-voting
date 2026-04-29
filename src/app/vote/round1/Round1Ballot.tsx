"use client";

import { useState, useTransition } from "react";
import { submitRound1Ballot } from "@/app/actions/vote";
import { formatTopicDisplay } from "@/lib/formatTopicDisplay";

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
}: {
    sessionId: string;
    topics: Topic[];
    selected: string[];
    userTopic: UserTopic;
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

    const toggle = (id: string) => {
        setError(null);
        setJustSaved(false);
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                if (next.size + (userTopicActive ? 1 : 0) >= REQUIRED_PICKS) {
                    setError(`You can pick at most ${REQUIRED_PICKS} topics.`);
                    return prev;
                }
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
    const remaining = REQUIRED_PICKS - totalPicks;

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
                    You must pick exactly {REQUIRED_PICKS} topics. Don&apos;t
                    see yours? Suggest your own at the bottom — it counts as one
                    of your picks. Any topic that gets at least one vote moves
                    on to Round 2.
                </p>
            </header>

            <div className="sticky top-0 z-10 -mx-6 mb-4 flex items-center justify-between border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]/90 px-6 py-3 backdrop-blur">
                <p className="text-sm tabular-nums">
                    <span className="font-semibold">{totalPicks}</span>
                    <span className="text-[color:var(--color-muted)]">
                        {" "}
                        of {REQUIRED_PICKS} selected
                    </span>
                    {!isComplete ? (
                        <span className="ml-2 text-xs text-[color:var(--color-muted)]">
                            (Pick {remaining} more)
                        </span>
                    ) : null}
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
                                ? `Pick ${remaining} more topic${remaining === 1 ? "" : "s"} to save your ballot.`
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
                    const capped = !isSelected && totalPicks >= REQUIRED_PICKS;
                    return (
                        <li key={t.id}>
                            <button
                                type="button"
                                onClick={() => toggle(t.id)}
                                disabled={capped}
                                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                                    isSelected
                                        ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10"
                                        : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:border-[color:var(--color-accent)]/60"
                                } ${capped ? "cursor-not-allowed opacity-40" : ""}`}
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
                                <label
                                    htmlFor="user-topic"
                                    className="block text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-muted)]"
                                >
                                    Suggest your own topic
                                </label>
                                <textarea
                                    id="user-topic"
                                    value={userText}
                                    onChange={(e) =>
                                        handleUserTextChange(e.target.value)
                                    }
                                    disabled={userTopicLocked}
                                    rows={2}
                                    maxLength={USER_TOPIC_MAX_LEN}
                                    placeholder={
                                        userTopicLocked
                                            ? "Uncheck a topic above to add your own."
                                            : "A topic that's missing from the list…"
                                    }
                                    className="mt-1 w-full resize-y bg-transparent text-sm font-medium text-pretty outline-none placeholder:font-normal placeholder:text-[color:var(--color-muted)] disabled:cursor-not-allowed"
                                />
                                <p className="mt-1 text-[11px] text-[color:var(--color-muted)]">
                                    {userTopicActive
                                        ? "Counts as 1 of your 3 picks. Editable until Round 1 closes."
                                        : "If filled in, this counts as 1 of your 3 picks."}
                                </p>
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
