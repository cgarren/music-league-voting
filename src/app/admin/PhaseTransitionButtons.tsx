"use client";

import { useState, useTransition } from "react";
import { transitionPhase } from "@/app/actions/admin";

type Action = {
  to: string;
  label: string;
};

export function PhaseTransitionButtons({
  actions,
  topicsCount,
}: {
  actions: Action[];
  topicsCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmTo, setConfirmTo] = useState<string | null>(null);

  const handleSubmit = (actionTo: string, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Intercept if trying to advance to round1 with no topics loaded (0 active topics in topics table)
    if (actionTo === "round1" && topicsCount === 0) {
      setConfirmTo(actionTo);
    } else {
      runTransition(actionTo);
    }
  };

  const runTransition = (toPhase: string) => {
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("to", toPhase);
        await transitionPhase(formData);
      } catch (err) {
        alert((err as Error).message);
      }
    });
  };

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        {actions.map((action, i, arr) => {
          const isPrimary = i === arr.length - 1;
          return (
            <form
              key={action.to}
              onSubmit={(e) => handleSubmit(action.to, e)}
              action={transitionPhase}
            >
              <input type="hidden" name="to" value={action.to} />
              <button
                type="submit"
                disabled={pending}
                className={
                  isPrimary
                    ? "rounded-full bg-[color:var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[color:var(--color-accent-strong)] disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                    : "rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-4 py-2 text-sm font-medium hover:border-[color:var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                }
              >
                {action.label}
              </button>
            </form>
          );
        })}
      </div>

      {confirmTo && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
          onClick={() => setConfirmTo(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 shadow-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">Start Round 1 with no topics?</h3>
            <p className="mt-2 text-sm text-[color:var(--color-muted)] leading-relaxed">
              There are currently <strong className="text-white">0 active topics</strong> loaded for this session. Please click the import button to import topics before starting Round 1.
            </p>
            <p className="mt-2 text-sm text-[color:var(--color-muted)] leading-relaxed">
              If you start Round 1 now, voters will not have any options on their ballots. <span className="font-semibold">Are you sure you want to proceed?</span>
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmTo(null)}
                disabled={pending}
                className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-5 py-2 text-xs font-medium hover:border-[color:var(--color-accent)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmTo(null);
                  runTransition(confirmTo);
                }}
                disabled={pending}
                className="rounded-full bg-[color:var(--color-danger)] px-5 py-2 text-xs font-medium text-white hover:bg-[color:var(--color-danger)]/80 transition-colors disabled:opacity-50"
              >
                {pending ? "Advancing..." : "Yes, start Round 1"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
