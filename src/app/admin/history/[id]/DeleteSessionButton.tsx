"use client";

import { useState, useTransition } from "react";
import { deleteSession } from "@/app/actions/admin";

export function DeleteSessionButton({
  sessionId,
  sessionName,
}: {
  sessionId: string;
  sessionName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDelete = () => {
    setErrorMsg(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("id", sessionId);
        await deleteSession(formData);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "An error occurred");
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="rounded-full border border-[color:var(--color-danger)] bg-transparent text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 px-4 py-2 text-xs font-semibold tracking-wider uppercase transition-colors"
      >
        Delete Session
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="w-full max-w-md rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 shadow-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">Delete Session?</h3>
            <p className="mt-2 text-sm text-[color:var(--color-muted)]">
              Are you sure you want to permanently delete{" "}
              <strong className="text-white">&ldquo;{sessionName}&rdquo;</strong>?
              This will erase all associated topics and round votes. This action cannot be undone.
            </p>

            {errorMsg && (
              <p className="mt-3 text-xs text-[color:var(--color-danger)] bg-[color:var(--color-danger)]/10 border border-[color:var(--color-danger)]/20 px-3 py-2 rounded-lg">
                {errorMsg}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  if (!isPending) setIsOpen(false);
                }}
                disabled={isPending}
                className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-5 py-2 text-xs font-medium hover:border-[color:var(--color-accent)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="rounded-full bg-[color:var(--color-danger)] px-5 py-2 text-xs font-medium text-white hover:bg-[color:var(--color-danger)]/80 transition-colors disabled:opacity-50"
              >
                {isPending ? "Deleting..." : "Yes, Delete Session"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
