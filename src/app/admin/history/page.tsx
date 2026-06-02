import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser, isAdminConfigured } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/server";
import { PHASE_LABEL, type Phase } from "@/lib/session";

export default async function HistoryPage() {
  if (!isAdminConfigured()) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Admin unavailable</h1>
        <p className="mt-2 text-[color:var(--color-muted)]">
          No admin emails are configured. Set the <code>ADMIN_EMAILS</code>{" "}
          environment variable to a comma-separated list of admin addresses and
          redeploy.
        </p>
      </div>
    );
  }

  const admin = await getAdminUser();
  if (!admin) redirect("/?admin_required=1");

  const db = createAdminClient();
  const { data: sessions, error } = await db
    .from("sessions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-6">
        <Link
          href="/admin"
          className="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-accent)] hover:underline inline-flex items-center gap-1 mb-2"
        >
          &larr; Back to Admin Dashboard
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Session History</h1>
            <p className="mt-1 text-sm text-[color:var(--color-muted)]">
              Manage and inspect all past voting sessions. Signed in as {admin.email}
            </p>
          </div>
        </div>
      </div>

      {!sessions || sessions.length === 0 ? (
        <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 text-center">
          <p className="text-sm text-[color:var(--color-muted)] italic">
            No sessions have been created yet.
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-4 mt-6">
          {sessions.map((s) => {
            const isActive = s.archived_at === null;
            const created = new Date(s.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const archived = s.archived_at
              ? new Date(s.archived_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : null;

            return (
              <div
                key={s.id}
                className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 hover:border-[color:var(--color-accent)]/50 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              >
                <div>
                  <h2 className="text-lg font-semibold">
                    <Link
                      href={isActive ? "/admin" : `/admin/history/${s.id}`}
                      className="hover:text-[color:var(--color-accent)] hover:underline"
                    >
                      {s.name}
                    </Link>
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--color-muted)]">
                    <span>Created {created}</span>
                    {archived && (
                      <>
                        <span>&middot;</span>
                        <span>Archived {archived}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={
                      isActive
                        ? "rounded-full border border-[color:var(--color-success)]/40 bg-[color:var(--color-success)]/10 px-3 py-1 text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-success)]"
                        : "rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-1 text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-muted)]"
                    }
                  >
                    {isActive ? "Active" : "Archived"}
                  </span>
                  {isActive && (
                    <span className="rounded-full border border-[color:var(--color-accent)]/30 bg-[color:var(--color-accent)]/5 px-3 py-1 text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-accent)]">
                      {PHASE_LABEL[s.phase as Phase] || s.phase}
                    </span>
                  )}
                  <Link
                    href={isActive ? "/admin" : `/admin/history/${s.id}`}
                    className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-4 py-2 text-xs font-medium hover:border-[color:var(--color-accent)] transition-colors"
                  >
                    {isActive ? "Admin Dashboard" : "View Details"} &rarr;
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
