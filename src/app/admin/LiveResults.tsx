import { formatTopicDisplay } from "@/lib/formatTopicDisplay";
import { pluralize } from "@/lib/pluralize";

// Admin-only bar chart of vote counts. Presentational server component; all
// gating/permissions happen in the caller.
//
// Topic lists can run into the hundreds, and during early voting most rows
// are still at zero. To keep the chart useful we only show topics with at
// least one vote by default, and tuck the remainder behind a collapsible
// "show rest" control.

export type LiveResultsRow = {
  topic_id: string;
  topic_text: string;
  submitter: string | null;
  value: number;
};

export function LiveResults({
  title,
  caption,
  rows,
  unitSingular,
  unitPlural,
  accentVar,
  emptyMessage,
  showSubmitter = true,
}: {
  title: string;
  caption?: string;
  rows: LiveResultsRow[];
  unitSingular: string;
  unitPlural: string;
  accentVar: string; // CSS var ref, e.g. "--color-accent"
  emptyMessage: string;
  showSubmitter?: boolean;
}) {
  const sorted = [...rows].sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    return a.topic_text.localeCompare(b.topic_text);
  });
  const activeRows = sorted.filter((r) => r.value > 0);
  const idleRows = sorted.filter((r) => r.value === 0);
  const max = sorted.reduce((m, r) => Math.max(m, r.value), 0);
  const total = sorted.reduce((s, r) => s + r.value, 0);

  return (
    <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          {caption ? (
            <p className="mt-1 text-xs text-[color:var(--color-muted)]">
              {caption}
            </p>
          ) : null}
        </div>
        <div className="text-xs text-[color:var(--color-muted)]">
          {activeRows.length} of {sorted.length} topic
          {sorted.length === 1 ? "" : "s"} ·{" "}
          <span className="tabular-nums">{total}</span>{" "}
          {pluralize(total, unitSingular, unitPlural)} total
        </div>
      </div>

      {activeRows.length === 0 && idleRows.length === 0 ? (
        <p className="mt-6 text-sm text-[color:var(--color-muted)]">
          {emptyMessage}
        </p>
      ) : (
        <>
          {activeRows.length === 0 ? (
            <p className="mt-6 text-sm text-[color:var(--color-muted)]">
              {emptyMessage}
            </p>
          ) : (
            <ol className="mt-5 space-y-3">
              {activeRows.map((row, i) => (
                <ChartRow
                  key={row.topic_id}
                  row={row}
                  index={i}
                  max={max}
                  unitSingular={unitSingular}
                  unitPlural={unitPlural}
                  accentVar={accentVar}
                  showSubmitter={showSubmitter}
                />
              ))}
            </ol>
          )}

          {idleRows.length > 0 ? (
            <details className="group mt-4 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]/60">
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-xs text-[color:var(--color-muted)] [&::-webkit-details-marker]:hidden">
                <span>
                  Show {idleRows.length} topic{idleRows.length === 1 ? "" : "s"}{" "}
                  with 0 {pluralize(0, unitSingular, unitPlural)}
                </span>
                <Chevron />
              </summary>
              <ol className="space-y-3 px-4 pb-4 pt-2">
                {idleRows.map((row, i) => (
                  <ChartRow
                    key={row.topic_id}
                    row={row}
                    index={activeRows.length + i}
                    max={max}
                    unitSingular={unitSingular}
                    unitPlural={unitPlural}
                    accentVar={accentVar}
                    showSubmitter={showSubmitter}
                  />
                ))}
              </ol>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function ChartRow({
  row,
  index,
  max,
  unitSingular,
  unitPlural,
  accentVar,
  showSubmitter,
}: {
  row: LiveResultsRow;
  index: number;
  max: number;
  unitSingular: string;
  unitPlural: string;
  accentVar: string;
  showSubmitter: boolean;
}) {
  const pct = max === 0 ? 0 : (row.value / max) * 100;
  return (
    <li className="flex items-start gap-3 text-sm">
      <span className="mt-0.5 w-6 shrink-0 text-right text-xs tabular-nums text-[color:var(--color-muted)]">
        {index + 1}.
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">
              {formatTopicDisplay(row.topic_text)}
            </p>
            {showSubmitter && row.submitter ? (
              <p className="truncate text-xs text-[color:var(--color-muted)]">
                {row.submitter}
              </p>
            ) : null}
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {row.value}
            <span className="ml-1 text-xs font-normal text-[color:var(--color-muted)]">
              {pluralize(row.value, unitSingular, unitPlural)}
            </span>
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[color:var(--color-surface-elevated)]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              backgroundColor: `var(${accentVar})`,
            }}
          />
        </div>
      </div>
    </li>
  );
}

function Chevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="shrink-0 transition-transform group-open:rotate-180"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
