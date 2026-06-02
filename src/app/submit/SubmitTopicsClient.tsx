"use client";

import { useState, useTransition, useOptimistic, useRef, useMemo } from "react";
import { submitTopic } from "@/app/actions/submit";
import { formatTopicDisplay } from "@/lib/formatTopicDisplay";
import { pluralize } from "@/lib/pluralize";
import { findSimilarItems } from "@/lib/similarity";
import { normalizeTopic } from "@/lib/normalize";

type Submission = {
  id: string;
  topic_text: string;
  user_id: string;
  created_at: string;
};

const MAX_TOPIC_LEN = 100;

export function SubmitTopicsClient({
  sessionName,
  submissionCap,
  currentUserId,
  initialSubmissions,
}: {
  sessionName: string;
  submissionCap: number | null;
  currentUserId: string;
  initialSubmissions: Submission[];
}) {
  const [topicText, setTopicText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // Optimistic UI updates to display the topic immediately while saving
  const [optimisticSubmissions, addOptimisticSubmission] = useOptimistic(
    initialSubmissions,
    (state, newSubmission: Submission) => [newSubmission, ...state]
  );

  const similarSuggestions = useMemo(() => {
    if (pending) return [];
    const normQuery = normalizeTopic(topicText);
    if (!normQuery) return [];
    return findSimilarItems(
      topicText,
      optimisticSubmissions,
      (s) => s.topic_text,
      0.55
    );
  }, [topicText, optimisticSubmissions, pending]);

  const userSubmissions = optimisticSubmissions.filter(
    (s) => s.user_id === currentUserId
  );
  const userCount = userSubmissions.length;
  const isCapReached = submissionCap !== null && submissionCap > 0 && userCount >= submissionCap;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const trimmed = topicText.trim();
    if (!trimmed) {
      setError("Topic text cannot be empty.");
      return;
    }

    if (trimmed.length > MAX_TOPIC_LEN) {
      setError(`Topic cannot exceed ${MAX_TOPIC_LEN} characters.`);
      return;
    }

    // Client-side duplicate check
    const isDuplicate = optimisticSubmissions.some(
      (s) => s.topic_text.toLowerCase().replace(/\s+/g, " ") === trimmed.toLowerCase().replace(/\s+/g, " ")
    );
    if (isDuplicate) {
      setError("This topic suggestion has already been submitted.");
      return;
    }

    startTransition(async () => {
      const tempId = crypto.randomUUID();
      const optimisticSub: Submission = {
        id: tempId,
        topic_text: trimmed,
        user_id: currentUserId,
        created_at: new Date().toISOString(),
      };

      // Apply optimistic update
      addOptimisticSubmission(optimisticSub);
      setTopicText("");

      try {
        const formData = new FormData();
        formData.append("topic", trimmed);
        await submitTopic(formData);
      } catch (err) {
        setError((err as Error).message);
        // Put the text back if it failed
        setTopicText(trimmed);
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <header className="mb-8">
        <span className="rounded-full border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 px-3 py-1 text-xs font-medium tracking-wide text-[color:var(--color-accent)]">
          Submissions Phase
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          Suggest Topics
        </h1>
        <p className="mt-2 text-sm text-[color:var(--color-muted)]">
          Submit topics you want to see on the voting ballot for {sessionName}. Keep in mind, topics can&apos;t be deleted.
        </p>
      </header>

      {/* Cap notification */}
      {submissionCap !== null && submissionCap > 0 && (
        <div className="mb-6 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 text-xs text-[color:var(--color-muted)] flex items-center justify-between">
          <span>
            Submission Cap: <strong className="text-[color:var(--color-accent)]">{submissionCap}</strong> topics per user.
          </span>
          <span>
            You have submitted: <strong className="text-[color:var(--color-accent)]">{userCount}</strong> / {submissionCap}
          </span>
        </div>
      )}

      {/* Quick Add Form — sticky so it stays visible while scrolling through the list */}
      <div className="sticky top-0 z-10 -mx-6 px-6 pt-4 pb-4 bg-[color:var(--color-background)]/90 backdrop-blur border-b border-[color:var(--color-border)] mb-8">
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5 shadow-sm"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="topic-input"
              className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-muted)]"
            >
              Add a Topic Suggestion
            </label>
            <div className="relative">
              <input
                id="topic-input"
                type="text"
                name="topic"
                autoComplete="off"
                autoFocus={!isCapReached}
                value={topicText}
                onChange={(e) => {
                  setError(null);
                  setTopicText(e.target.value.slice(0, MAX_TOPIC_LEN));
                }}
                disabled={pending || isCapReached}
                placeholder={
                  isCapReached
                    ? "You have reached your submission limit."
                    : "Enter a topic prompt or idea..."
                }
                className="w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-4 py-3 pr-16 text-sm font-medium text-pretty outline-none focus:border-[color:var(--color-accent)]/80 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-[color:var(--color-muted)]">
                {MAX_TOPIC_LEN - topicText.length}
              </span>
            </div>
          </div>

          {similarSuggestions.length > 0 && (
            <div className="rounded-xl border border-[color:var(--color-accent)]/20 bg-[color:var(--color-accent)]/[0.02] p-4 text-xs animate-slide-up flex flex-col gap-2">
              <span className="font-semibold text-[color:var(--color-accent)] flex items-center gap-1.5">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {similarSuggestions.length === 1 ? "A similar suggestion already exists:" : "Similar suggestions already exist:"}
              </span>
              <ul className="space-y-1.5 text-[color:var(--color-muted)]">
                {similarSuggestions.slice(0, 3).map((match) => (
                  <li key={match.item.id} className="flex items-start gap-1.5 min-w-0">
                    <span className="mt-0.5 flex-none text-[color:var(--color-muted)]">•</span>
                    <span className="min-w-0 wrap-anywhere font-medium text-[color:var(--color-foreground)]">
                      {formatTopicDisplay(match.item.topic_text)}
                      {match.score > 0.85 && (
                        <span className="ml-2 rounded-full bg-[color:var(--color-danger)]/15 px-1.5 py-0.5 text-[9px] font-medium text-[color:var(--color-danger)] tracking-wide">
                          High match
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-[color:var(--color-muted)]/75">
                {"If one of these matches your idea, you don't need to submit a duplicate. You'll be able to vote for it during the voting rounds!"}
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 px-3 py-2 text-xs text-[color:var(--color-danger)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || isCapReached || !topicText.trim()}
            className="w-full sm:w-auto self-end rounded-full bg-[color:var(--color-accent)] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[color:var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-md shadow-[color:var(--color-accent)]/10"
          >
            {pending ? "Adding..." : "Add Suggestion"}
          </button>
        </div>
      </form>
      </div>

      {/* Submissions List */}
      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[color:var(--color-muted)]">
          {optimisticSubmissions.length} {pluralize(optimisticSubmissions.length, "Topic Suggestion", "Topic Suggestions") + " so far..."}
        </h2>

        {optimisticSubmissions.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-[color:var(--color-border)] px-6 py-12 text-center">
            <p className="text-sm text-[color:var(--color-muted)]">
              No suggestions have been submitted yet. Be the first!
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {optimisticSubmissions.map((sub) => {
              const isOwn = sub.user_id === currentUserId;
              return (
                <li
                  key={sub.id}
                  className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3.5 flex items-center justify-between transition-all"
                >
                  <div className="min-w-0 flex-1 wrap-anywhere pr-3">
                    <p className="text-sm font-medium text-pretty">
                      {formatTopicDisplay(sub.topic_text)}
                    </p>
                  </div>
                  {isOwn && (
                    <span className="rounded-full border border-[color:var(--color-accent)]/20 bg-[color:var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[color:var(--color-accent)]">
                      Your Suggestion
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
