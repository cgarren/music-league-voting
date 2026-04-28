"use client";

import { useMemo, useState, useTransition } from "react";
import { submitRound2Ballot } from "@/app/actions/vote";
import { formatTopicDisplay } from "@/lib/formatTopicDisplay";
import { pluralize } from "@/lib/pluralize";

type Topic = {
  topic_id: string;
  topic_text: string;
};

const TOTAL_VOTES = 10;

export function Round2Ballot({
  sessionId,
  topics,
  existing,
}: {
  sessionId: string;
  topics: Topic[];
  existing: Record<string, number>;
}) {
  const [weights, setWeights] = useState<Record<string, number>>(() =>
    Object.fromEntries(topics.map((t) => [t.topic_id, existing[t.topic_id] ?? 0])),
  );
  const [savedWeights, setSavedWeights] = useState<Record<string, number>>(() =>
    Object.fromEntries(topics.map((t) => [t.topic_id, existing[t.topic_id] ?? 0])),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const spent = useMemo(
    () => Object.values(weights).reduce((s, w) => s + w, 0),
    [weights],
  );
  const remaining = TOTAL_VOTES - spent;
  const isComplete = remaining === 0;

  const isDirty = useMemo(() => {
    for (const t of topics) {
      if ((weights[t.topic_id] ?? 0) !== (savedWeights[t.topic_id] ?? 0))
        return true;
    }
    return false;
  }, [weights, savedWeights, topics]);

  const change = (id: string, delta: number) => {
    setError(null);
    setJustSaved(false);
    setWeights((prev) => {
      const current = prev[id] ?? 0;
      const next = current + delta;
      if (next < 0) return prev;
      const totalIfApplied =
        Object.entries(prev).reduce(
          (s, [k, v]) => s + (k === id ? next : v),
          0,
        );
      if (totalIfApplied > TOTAL_VOTES) {
        setError(`You only have ${TOTAL_VOTES} votes to spend.`);
        return prev;
      }
      return { ...prev, [id]: next };
    });
  };

  const reset = () => {
    setError(null);
    setJustSaved(false);
    setWeights(Object.fromEntries(topics.map((t) => [t.topic_id, 0])));
  };

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      try {
        await submitRound2Ballot({
          session_id: sessionId,
          allocations: topics.map((t) => ({
            topic_id: t.topic_id,
            weight: weights[t.topic_id] ?? 0,
          })),
        });
        setSavedWeights({ ...weights });
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
          Round 2
        </span>
        <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight">
          Spend your {TOTAL_VOTES} votes
        </h1>
        <p className="mt-2 text-pretty text-sm text-[color:var(--color-muted)]">
          Pile all {TOTAL_VOTES} on one, or spread them around — you must spend
          every vote. Vote on the idea, not the wording; that gets figured out
          later. You can revise until Round 2 closes.
        </p>
      </header>

      <div className="sticky top-0 z-10 -mx-6 mb-4 flex items-center justify-between border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]/90 px-6 py-3 backdrop-blur">
        <p className="text-sm tabular-nums">
          <span
            className={`font-semibold ${
              remaining === 0
                ? "text-[color:var(--color-success)]"
                : remaining < 0
                  ? "text-[color:var(--color-danger)]"
                  : ""
            }`}
          >
            {remaining}
          </span>
          <span className="text-[color:var(--color-muted)]">
            {" "}
            {pluralize(remaining, "vote", "votes")} left
          </span>
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-foreground)]"
          >
            Reset
          </button>
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
                ? remaining > 0
                  ? `Spend ${remaining} more ${pluralize(remaining, "vote", "votes")} to save your ballot.`
                  : "Remove votes until you’re back to 10."
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
          const w = weights[t.topic_id] ?? 0;
          const label = formatTopicDisplay(t.topic_text);
          return (
            <li
              key={t.topic_id}
              className={`rounded-xl border px-4 py-3 transition-colors ${
                w > 0
                  ? "border-[color:var(--color-accent)]/60 bg-[color:var(--color-accent)]/5"
                  : "border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
              }`}
            >
              <div className="flex items-center gap-4">
                {/* min-w-0 lets this flex child shrink below its intrinsic
                    size; overflow-wrap:anywhere breaks runs without natural
                    break opportunities (e.g. "lolllllllllll…") so they can't
                    push the +/- controls off the card. */}
                <div className="min-w-0 flex-1 wrap-anywhere">
                  <p className="text-sm font-medium text-pretty">{label}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => change(t.topic_id, -1)}
                    disabled={w === 0}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] text-lg leading-none hover:border-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`Remove 1 vote from ${label}`}
                  >
                    −
                  </button>
                  <span
                    className={`w-6 text-center text-sm font-semibold ${
                      w > 0 ? "text-[color:var(--color-accent)]" : "text-[color:var(--color-muted)]"
                    }`}
                  >
                    {w}
                  </span>
                  <button
                    type="button"
                    onClick={() => change(t.topic_id, +1)}
                    disabled={remaining <= 0}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] text-lg leading-none hover:border-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`Add 1 vote to ${label}`}
                  >
                    +
                  </button>
                </div>
              </div>
              {w > 0 ? (
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-border)]">
                  <div
                    className="h-full bg-[color:var(--color-accent)]"
                    style={{ width: `${(w / TOTAL_VOTES) * 100}%` }}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
