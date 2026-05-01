"use client";

import {
  formatDeadline,
  formatDeadlineInTimeZone,
  isDeadlinePast,
} from "@/lib/formatDeadline";

/**
 * Prominent target-deadline notice for the voting pages.
 *
 * Renders nothing when no deadline has been set so callers can use it
 * unconditionally inside their headers. The voting pages remain functional
 * past the deadline; this component only describes the *target* — the round
 * is closed manually by the admin via a phase transition.
 */
export function DeadlineNotice({
  deadline,
  roundLabel,
  originalTimezone,
}: {
  deadline: string | null | undefined;
  roundLabel: string;
  originalTimezone?: string | null;
}) {
  const formatted = formatDeadline(deadline);
  const past = isDeadlinePast(deadline);
  const viewerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;

  const showOriginalTzNote =
    !!originalTimezone &&
    !!viewerTimezone &&
    originalTimezone !== viewerTimezone;
  const originalFormatted = showOriginalTzNote
    ? formatDeadlineInTimeZone(deadline, originalTimezone)
    : null;
  if (!formatted) return null;

  const shellClass = past
    ? "mt-4 flex flex-col gap-3 rounded-xl border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 px-4 py-3 text-sm"
    : "mt-4 flex flex-col gap-3 rounded-xl border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 px-4 py-3 text-sm";

  const primaryRowClass =
    "flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3";

  return (
    <div role="note" className={shellClass}>
      <div className={primaryRowClass}>
        <span
          className={
            past
              ? "shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-danger)]"
              : "shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-accent)]"
          }
        >
          {past ? `${roundLabel} deadline passed` : `${roundLabel} deadline`}
        </span>
        <span className="min-w-0 flex-1 font-medium text-pretty sm:min-w-[12rem]">
          {formatted}
        </span>
        {past ? (
          <span className="text-[color:var(--color-muted)] sm:ml-auto sm:text-xs">
            Voting still open until the admin closes the round.
          </span>
        ) : null}
      </div>
      {originalFormatted && originalTimezone ? (
        <p className="m-0 text-[11px] leading-snug text-[color:var(--color-muted)] wrap-anywhere text-pretty">
          Original timezone ({originalTimezone}): {originalFormatted}
        </p>
      ) : null}
    </div>
  );
}
