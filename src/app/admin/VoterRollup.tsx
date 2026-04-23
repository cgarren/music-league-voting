import { pluralize } from "@/lib/pluralize";

// Admin-only voter rollup. One row per distinct participant across both rounds.
// Presentational; caller is responsible for privilege gating + data fetching.

export type VoterRow = {
  user_id: string;
  name: string;
  email: string;
  r1_picks: number; // topic selections cast in round 1 (max 3)
  r2_votes: number; // Round 2 vote weight per user (max 10)
};

export function VoterRollup({ voters }: { voters: VoterRow[] }) {
  const sorted = [...voters].sort((a, b) => {
    // Active voters first; then alphabetical.
    const aActive = a.r1_picks + a.r2_votes;
    const bActive = b.r1_picks + b.r2_votes;
    if (bActive !== aActive) return bActive - aActive;
    return a.name.localeCompare(b.name);
  });
  const r1Voters = sorted.filter((v) => v.r1_picks > 0).length;
  const r2Voters = sorted.filter((v) => v.r2_votes > 0).length;
  const r1Picks = sorted.reduce((s, v) => s + v.r1_picks, 0);
  const r2VoteTotal = sorted.reduce((s, v) => s + v.r2_votes, 0);

  return (
    <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Voters</h3>
          <p className="mt-1 text-xs text-[color:var(--color-muted)]">
            Everyone who has cast at least one ballot in the current session.
          </p>
        </div>
        <div className="text-xs text-[color:var(--color-muted)]">
          {sorted.length}{" "}
          {pluralize(sorted.length, "participant", "participants")}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-6 text-sm text-[color:var(--color-muted)]">
          No ballots yet.
        </p>
      ) : (
        <div className="mt-4 -mx-6 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
                <th className="py-2 pl-6 pr-3 font-medium sm:pl-0">Voter</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 text-right font-medium">
                  R1 picks made
                </th>
                <th className="py-2 pl-3 pr-6 text-right font-medium sm:pr-0">
                  R2 votes
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((v) => (
                <tr
                  key={v.user_id}
                  className="border-t border-[color:var(--color-border)]"
                >
                  <td className="py-2 pl-6 pr-3 sm:pl-0">
                    <p className="font-medium">{v.name}</p>
                  </td>
                  <td className="px-3 py-2 text-[color:var(--color-muted)]">
                    {v.email}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <VoteCount value={v.r1_picks} target={3} />
                  </td>
                  <td className="py-2 pl-3 pr-6 text-right tabular-nums sm:pr-0">
                    <VoteCount value={v.r2_votes} target={10} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]/50 text-xs uppercase tracking-wide text-[color:var(--color-muted)]">
                <td className="py-2 pl-6 pr-3 font-medium sm:pl-0">Totals</td>
                <td className="px-3 py-2 tabular-nums">
                  {r1Voters} R1 · {r2Voters} R2
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-[color:var(--color-foreground)]">
                  {r1Picks}{" "}
                  <span className="font-normal normal-case">
                    {pluralize(r1Picks, "pick made", "picks made")}
                  </span>
                </td>
                <td className="py-2 pl-3 pr-6 text-right font-semibold tabular-nums text-[color:var(--color-foreground)] sm:pr-0">
                  {r2VoteTotal}{" "}
                  <span className="font-normal normal-case">
                    {pluralize(r2VoteTotal, "vote", "votes")}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function VoteCount({ value, target }: { value: number; target: number }) {
  const tone =
    value === 0
      ? "text-[color:var(--color-muted)]"
      : value >= target
        ? "text-[color:var(--color-success)]"
        : "text-[color:var(--color-foreground)]";
  return (
    <>
      <span className={tone}>{value}</span>
      <span className="text-[color:var(--color-muted)]"> / {target}</span>
    </>
  );
}
