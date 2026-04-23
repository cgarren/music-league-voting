"use client";

import { useState, useTransition } from "react";
import { submitRound1Ballot } from "@/app/actions/vote";
import { formatTopicDisplay } from "@/lib/formatTopicDisplay";

type Topic = {
  id: string;
  topic_text: string;
};

const REQUIRED_PICKS = 3;

export function Round1Ballot({
  sessionId,
  topics,
  selected: initialSelected,
}: {
  sessionId: string;
  topics: Topic[];
  selected: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelected),
  );
  const [savedSelection, setSavedSelection] = useState<Set<string>>(
    () => new Set(initialSelected),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);

  const toggle = (id: string) => {
    setError(null);
    setJustSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= REQUIRED_PICKS) {
          setError(`You can pick at most ${REQUIRED_PICKS} topics.`);
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  const isDirty = !setsEqual(selected, savedSelection);
  const isComplete = selected.size === REQUIRED_PICKS;
  const remaining = REQUIRED_PICKS - selected.size;

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      try {
        await submitRound1Ballot({
          session_id: sessionId,
          topic_ids: Array.from(selected),
        });
        setSavedSelection(new Set(selected));
        setJustSaved(true);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <header className="mb-6">
        <span className="rounded-full border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 px-3 py-1 text-xs font-medium tracking-wide text-[color:var(--color-accent)]">
          Round 1
        </span>
        <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight">
          Pick your {REQUIRED_PICKS} favourite topics
        </h1>
        <p className="mt-2 text-pretty text-sm text-[color:var(--color-muted)]">
          You must pick exactly {REQUIRED_PICKS} topics. Any topic that
          receives at least one vote will move on to Round 2. You can change
          your picks any time before Round 1 closes.
        </p>
      </header>

      <div className="sticky top-0 z-10 -mx-6 mb-4 flex items-center justify-between border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]/90 px-6 py-3 backdrop-blur">
        <p className="text-sm tabular-nums">
          <span className="font-semibold">{selected.size}</span>
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
            {pending ? "Saving…" : isDirty ? "Save ballot" : "Saved"}
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
          const capped = !isSelected && selected.size >= REQUIRED_PICKS;
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
                  <span
                    className={`mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-md border ${
                      isSelected
                        ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white"
                        : "border-[color:var(--color-border)]"
                    }`}
                    aria-hidden
                  >
                    {isSelected ? (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                      >
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
                  <div className="flex-1">
                    <p className="text-sm font-medium text-pretty">
                      {formatTopicDisplay(t.topic_text)}
                    </p>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function setsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
