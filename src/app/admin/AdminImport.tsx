"use client";

import { useState, useTransition } from "react";
import {
  fetchSheetPreview,
  importTopics,
} from "@/app/actions/admin";
import { formatTopicDisplay } from "@/lib/formatTopicDisplay";
import type { ParsedTopic } from "@/lib/sheet";

type ExistingTopic = {
  id: string;
  topic_text: string;
  submitter: string;
};

type PreviewRow = ParsedTopic & { include: boolean; duplicate: boolean };

export function AdminImport({
  sessionId,
  sheetUrl,
  existingTopics,
}: {
  sessionId: string;
  sheetUrl: string | null;
  existingTopics: ExistingTopic[];
}) {
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(
    existingTopics.length > 0,
  );
  const [pending, startTransition] = useTransition();

  const handleFetch = async (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await fetchSheetPreview(formData);
      if (!result.ok) {
        setError(result.error);
        setPreview(null);
        return;
      }
      // Mark duplicates (same normalized text within the import).
      const counts = new Map<string, number>();
      result.topics.forEach((t) => {
        counts.set(t.normalized, (counts.get(t.normalized) ?? 0) + 1);
      });
      const seen = new Set<string>();
      const rows: PreviewRow[] = result.topics.map((t) => {
        const isDup = (counts.get(t.normalized) ?? 0) > 1;
        const firstOccurrence = !seen.has(t.normalized);
        seen.add(t.normalized);
        return {
          ...t,
          duplicate: isDup,
          include: firstOccurrence, // default: include only first occurrence of each dupe
        };
      });
      setPreview(rows);
    });
  };

  const handleCommit = () => {
    if (!preview) return;
    setError(null);
    const selected = preview.filter((r) => r.include);
    if (selected.length === 0) {
      setError("Select at least one topic to import.");
      return;
    }
    startTransition(async () => {
      try {
        await importTopics({
          session_id: sessionId,
          replace_existing: replaceExisting,
          topics: selected.map((r) => ({
            topic: r.topic,
            submitter: r.submitter,
          })),
        });
        setPreview(null);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const toggleRow = (idx: number) => {
    setPreview((prev) =>
      prev
        ? prev.map((r, i) => (i === idx ? { ...r, include: !r.include } : r))
        : prev,
    );
  };

  const selectAllPreview = () => {
    setPreview((prev) => prev?.map((r) => ({ ...r, include: true })) ?? prev);
  };

  const selectNoPreview = () => {
    setPreview((prev) => prev?.map((r) => ({ ...r, include: false })) ?? prev);
  };

  const selectedCount = preview?.filter((r) => r.include).length ?? 0;

  return (
    <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Import topics</h3>
          <p className="mt-1 text-xs text-[color:var(--color-muted)]">
            {existingTopics.length > 0
              ? `Currently ${existingTopics.length} topic${existingTopics.length === 1 ? "" : "s"} saved.`
              : "No topics imported yet."}
          </p>
        </div>
        <form action={handleFetch} className="flex gap-2">
          <input
            type="hidden"
            name="sheet_url"
            value={sheetUrl ?? ""}
          />
          <button
            type="submit"
            disabled={!sheetUrl || pending}
            className="rounded-full bg-[color:var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[color:var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending && !preview ? "Fetching…" : "Fetch from sheet"}
          </button>
        </form>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 px-3 py-2 text-sm text-[color:var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-border)] pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-[color:var(--color-muted)]">
                {selectedCount} of {preview.length} topics selected. Duplicates
                are pre-deselected; override as needed.
              </p>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={selectAllPreview}
                  disabled={pending || preview.length === 0}
                  className="text-[color:var(--color-muted)] hover:text-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Select all
                </button>
                <span className="text-[color:var(--color-border)]">/</span>
                <button
                  type="button"
                  onClick={selectNoPreview}
                  disabled={pending || selectedCount === 0}
                  className="text-[color:var(--color-muted)] hover:text-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Select none
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm">
              {existingTopics.length > 0 ? (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={replaceExisting}
                    onChange={(e) => setReplaceExisting(e.target.checked)}
                    className="accent-[color:var(--color-accent)]"
                  />
                  Replace existing
                </label>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setError(null);
                }}
                disabled={pending}
                className="rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium hover:border-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel import
              </button>
              <button
                type="button"
                onClick={handleCommit}
                disabled={pending || selectedCount === 0}
                className="rounded-full bg-[color:var(--color-success)] px-5 py-2 text-sm font-medium text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Saving…" : `Import ${selectedCount}`}
              </button>
            </div>
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {preview.map((row, idx) => (
              <li
                key={`${row.row}-${row.normalized}`}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                  row.duplicate
                    ? "border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]/60"
                    : "border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={row.include}
                  onChange={() => toggleRow(idx)}
                  className="mt-1 accent-[color:var(--color-accent)]"
                />
                <div className="flex-1">
                  <p className={row.duplicate ? "text-[color:var(--color-muted)]" : ""}>
                    {formatTopicDisplay(row.topic)}
                    {row.duplicate ? (
                      <span className="ml-2 rounded-full border border-[color:var(--color-border)] px-2 py-0.5 text-xs text-[color:var(--color-muted)]">
                        dup
                      </span>
                    ) : null}
                  </p>
                  {row.submitter ? (
                    <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                      {row.submitter}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

    </section>
  );
}
