"use client";

import { useMemo, useState, useTransition } from "react";
import { updateRoundDeadlines } from "@/app/actions/admin";
import {
  formatDeadline,
  formatDeadlineInTimeZone,
} from "@/lib/formatDeadline";
import {
  instantToDatetimeLocalInZone,
  parseDeadlineForStorage,
} from "@/lib/parseDeadlineForStorage";

type Field = "round1_deadline_at" | "round2_deadline_at";

type Props = {
  round1DeadlineAt: string | null;
  round2DeadlineAt: string | null;
  deadlineTimezone: string | null;
};

const COMMON_TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Sao_Paulo",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

function deadlineFieldsToNextZone<
  T extends {
    deadline_timezone: string;
    round1_deadline_at: string;
    round2_deadline_at: string;
  },
>(prev: T, nextTz: string): T {
  const oldTz = prev.deadline_timezone;
  const conv = (naive: string) => {
    if (!naive) return "";
    try {
      const iso = parseDeadlineForStorage(naive, oldTz);
      if (!iso) return "";
      return instantToDatetimeLocalInZone(iso, nextTz);
    } catch {
      return naive;
    }
  };
  return {
    ...prev,
    deadline_timezone: nextTz,
    round1_deadline_at: conv(prev.round1_deadline_at),
    round2_deadline_at: conv(prev.round2_deadline_at),
  };
}

function safeDeadlineToIso(raw: string, tz: string): string | null {
  if (!raw.trim()) return null;
  try {
    return parseDeadlineForStorage(raw, tz);
  } catch {
    return null;
  }
}

export function DeadlineEditor({
  round1DeadlineAt,
  round2DeadlineAt,
  deadlineTimezone,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";

  const resolvedInitialTimezone =
    deadlineTimezone && deadlineTimezone.trim().length > 0
      ? deadlineTimezone
      : browserTimezone;
  const initialTimezone = COMMON_TIMEZONES.includes(
    resolvedInitialTimezone as (typeof COMMON_TIMEZONES)[number],
  )
    ? resolvedInitialTimezone
    : "UTC";

  const [saved, setSaved] = useState(() => ({
    round1_deadline_at: round1DeadlineAt
      ? instantToDatetimeLocalInZone(round1DeadlineAt, initialTimezone)
      : "",
    round2_deadline_at: round2DeadlineAt
      ? instantToDatetimeLocalInZone(round2DeadlineAt, initialTimezone)
      : "",
    deadline_timezone: initialTimezone,
  }));
  const [values, setValues] = useState(saved);

  const isDirty = useMemo(
    () =>
      values.round1_deadline_at !== saved.round1_deadline_at ||
      values.round2_deadline_at !== saved.round2_deadline_at ||
      values.deadline_timezone !== saved.deadline_timezone,
    [saved, values],
  );

  const setField = (field: Field, next: string) => {
    setError(null);
    setValues((prev) => ({ ...prev, [field]: next }));
  };

  const clearField = (field: Field) => {
    setError(null);
    setValues((prev) => ({ ...prev, [field]: "" }));
  };

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set(
          "round1_deadline_at",
          values.round1_deadline_at
            ? parseDeadlineForStorage(
                values.round1_deadline_at,
                values.deadline_timezone,
              ) ?? ""
            : "",
        );
        formData.set(
          "round2_deadline_at",
          values.round2_deadline_at
            ? parseDeadlineForStorage(
                values.round2_deadline_at,
                values.deadline_timezone,
              ) ?? ""
            : "",
        );
        formData.set("deadline_timezone", values.deadline_timezone);
        await updateRoundDeadlines(formData);
        setSaved(values);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const round1SavedIso = useMemo(
    () => safeDeadlineToIso(saved.round1_deadline_at, saved.deadline_timezone),
    [saved.round1_deadline_at, saved.deadline_timezone],
  );
  const round2SavedIso = useMemo(
    () => safeDeadlineToIso(saved.round2_deadline_at, saved.deadline_timezone),
    [saved.round2_deadline_at, saved.deadline_timezone],
  );

  const round1BrowserLine = round1SavedIso ? formatDeadline(round1SavedIso) : null;
  const round2BrowserLine = round2SavedIso ? formatDeadline(round2SavedIso) : null;
  const showSelectedNote = saved.deadline_timezone !== browserTimezone;
  const round1SelectedLine =
    round1SavedIso && showSelectedNote
      ? formatDeadlineInTimeZone(round1SavedIso, saved.deadline_timezone)
      : null;
  const round2SelectedLine =
    round2SavedIso && showSelectedNote
      ? formatDeadlineInTimeZone(round2SavedIso, saved.deadline_timezone)
      : null;

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-xs text-[color:var(--color-muted)]">
        Choose the deadline timezone first. The date and time fields use that
        zone, not your browser&apos;s local zone.
      </p>

      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="deadline-timezone" className="font-medium">
          Deadline timezone
        </label>
        <div className="flex flex-wrap items-stretch gap-2">
          <select
            id="deadline-timezone"
            value={values.deadline_timezone}
            onChange={(e) => {
              setError(null);
              setValues((prev) => deadlineFieldsToNextZone(prev, e.target.value));
            }}
            className="min-w-[18rem] flex-1 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm focus:border-[color:var(--color-accent)] focus:outline-none"
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setError(null);
              const nextTz = COMMON_TIMEZONES.includes(
                browserTimezone as (typeof COMMON_TIMEZONES)[number],
              )
                ? browserTimezone
                : "UTC";
              setValues((prev) => deadlineFieldsToNextZone(prev, nextTz));
            }}
            className="rounded-lg border border-[color:var(--color-border)] px-3 text-xs font-medium text-[color:var(--color-muted)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
          >
            Use browser timezone
          </button>
        </div>
        <span className="text-[11px] text-[color:var(--color-muted)]">
          Voters see their own local time first; if it differs from this zone, we
          show a small note in this deadline timezone on the ballot too.
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <DeadlineField
          label="Round 1 deadline"
          value={values.round1_deadline_at}
          onChange={(next) => setField("round1_deadline_at", next)}
          onClear={() => clearField("round1_deadline_at")}
          clearDisabled={!values.round1_deadline_at}
          browserLine={round1BrowserLine}
          selectedTimezoneLine={round1SelectedLine}
        />
        <DeadlineField
          label="Round 2 deadline"
          value={values.round2_deadline_at}
          onChange={(next) => setField("round2_deadline_at", next)}
          onClear={() => clearField("round2_deadline_at")}
          clearDisabled={!values.round2_deadline_at}
          browserLine={round2BrowserLine}
          selectedTimezoneLine={round2SelectedLine}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        {error ? (
          <p className="text-xs text-[color:var(--color-danger)]">{error}</p>
        ) : null}
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !isDirty}
          className="rounded-full bg-[color:var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[color:var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Saving..." : "Save deadlines"}
        </button>
      </div>
    </div>
  );
}

function DeadlineField({
  label,
  value,
  onChange,
  onClear,
  clearDisabled,
  browserLine,
  selectedTimezoneLine,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onClear: () => void;
  clearDisabled: boolean;
  browserLine: string | null;
  selectedTimezoneLine: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex items-stretch gap-2">
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          title="Date and time in the deadline timezone you chose above"
          className="flex-1 min-w-0 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-2 text-sm focus:border-[color:var(--color-accent)] focus:outline-none"
        />
        <button
          type="button"
          onClick={onClear}
          disabled={clearDisabled}
          className="h-full rounded-lg border border-[color:var(--color-border)] px-3 text-xs font-medium text-[color:var(--color-muted)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[color:var(--color-border)] disabled:hover:text-[color:var(--color-muted)]"
        >
          Clear
        </button>
      </div>
      <span className="space-y-0.5 text-[11px] text-[color:var(--color-muted)]">
        {browserLine ? (
          <>
            <span className="block">
              Your time: {browserLine}.
            </span>
            {selectedTimezoneLine ? (
              <span className="block">
                Deadline timezone: {selectedTimezoneLine}.
              </span>
            ) : null}
          </>
        ) : (
          "Not set."
        )}
      </span>
    </div>
  );
}
