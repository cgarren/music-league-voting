<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project guide for AI agents

Companion notes for working on this codebase. Start with [README.md](README.md) for the product/spec side; this file focuses on engineering conventions and the sharp edges that aren't obvious from the code.

## What this project is

A two-round topic-voting app. Admin imports topic suggestions from a Google Sheet, users do a pick-3 round, then a 10-vote stackable round, then admin publishes the top 10. Google SSO, one vote per account.

## Stack pins and gotchas

- **Next.js 16 (App Router)** with Turbopack. The file convention `middleware.ts` is deprecated — this project uses `src/proxy.ts` exporting a `proxy(request)` function. If you rename it back, the build will fail with "Proxy is missing expected function export name".
- **Tailwind v4**. There is **no `tailwind.config.js`**. Theme tokens live in [`src/app/globals.css`](src/app/globals.css) under `@theme inline { ... }`. Add new colors/tokens there, then reference them with the arbitrary-value syntax `bg-[color:var(--color-TOKEN)]` (substitute your token name) or via the `@theme`-generated utility name.
- **React 19**. Server actions accepting typed object arguments (not just `FormData`) are fine when called programmatically from client components; avoid passing non-`FormData` actions directly to `<form action={...}>`.
- **`@supabase/ssr`** for the server-side Supabase client. The browser client is a separate factory. Never mix them.
- **Node 23** locally is fine despite `npm warn EBADENGINE` from upstream packages; ignore the warning.

## Directory layout

```
src/
  app/
    actions/       # "use server" server actions (auth.ts, admin.ts, vote.ts)
    admin/         # admin dashboard (page.tsx + AdminImport, LiveResults, VoterRollup)
    vote/round1/   # pick-3 ballot (page.tsx + Round1Ballot client)
    vote/round2/   # 10-vote stackable ballot (page.tsx + Round2Ballot client)
    results/       # top-10 (gated on phase = results)
    auth/callback/ # OAuth code exchange
    layout.tsx, page.tsx, globals.css
  components/
    BrandMark.tsx         # logo (nav + hero, two sizes)
    BackToHomeLink.tsx    # the one purple "Back to home" link
    GoogleSignInButton.tsx
  lib/
    supabase/             # client.ts (browser), server.ts (SSR + admin), middleware.ts
    admin.ts              # requireAdmin(), getAdminUser(), isAdminConfigured()
    session.ts            # Phase, PHASE_LABEL, getActiveSession(), getPublicSession(), hasUserVotedInRound()
    sheet.ts              # sheetUrlSchema, toCsvExportUrl, fetchAndParseSheet
    rate-limit.ts         # per-user token bucket (in-memory)
    pluralize.ts          # single source of truth for 1-vs-N noun grammar
    formatTopicDisplay.ts # normalize topic display text (trim/collapse/sentence-case)
    resultsVisual.ts      # strength-based card/bar styling for the results page
  proxy.ts                # Next 16 proxy; refreshes Supabase session cookies
supabase/
  migrations/
    0001_init.sql         # canonical schema. Keep this in lockstep with the DB.
```

## Supabase MCP

There is a live Supabase MCP connection (`plugin-supabase-supabase`) wired up at workspace level. Prefer it over `psql` / CLI when iterating:

- Project ref: **`pefdczcjpyurmmshroau`** (project name: "Music League Voting").
- Project URL: `https://pefdczcjpyurmmshroau.supabase.co`
- Publishable key and URL are already baked into [`.env.local`](.env.local). **`SUPABASE_SECRET_KEY` and `ADMIN_EMAILS` are intentionally empty** — the user must fill them locally; never commit values for these. The code also accepts the legacy `SUPABASE_SERVICE_ROLE_KEY` as a fallback, but prefer the new `sb_secret_...` format when creating keys.

Useful MCP tools:

- `execute_sql` — for iterating. Use this while developing.
- `apply_migration` — writes a migration history row. Use only when committing schema changes AND you have also saved matching SQL to `supabase/migrations/`.
- `get_advisors` — run BEFORE finalizing a schema change. Fix any `WARN`-level lints.
- `list_tables`, `list_migrations`, `get_publishable_keys` — read-only inspection.

## Schema conventions

All of these are invariants — break them at your peril.

1. **Every new public table needs three things**, in order:
   1. `enable row level security`
   2. Policies (see pattern below)
   3. Explicit `grant` to `authenticated` (Supabase projects no longer grant by default — RLS without a matching grant silently returns `permission denied`)
2. **`auth.uid()` inside policies must be wrapped**: `user_id = (select auth.uid())`. Using bare `auth.uid()` triggers a Supabase `auth_rls_initplan` performance advisor warning because the function is re-evaluated per row.
3. **Views**: always `with (security_invoker = true)`. Results published to non-admin users should go through a `security definer` function that gates on session phase (see `public.get_results` and `public.get_round2_ballot`).
4. **Never use `user_metadata` / `auth.jwt()` for authorisation.** Admin role is checked by email against `ADMIN_EMAILS` in [`src/lib/admin.ts`](src/lib/admin.ts). If you ever need role data in the DB, put it in `raw_app_meta_data` and query via server actions.
5. **`sessions` and `topics` are secret-key-only writes.** There are no insert/update/delete policies for authenticated users. All mutations happen inside [`src/app/actions/admin.ts`](src/app/actions/admin.ts) via `createAdminClient()` after `requireAdmin()`. (`createAdminClient` uses `SUPABASE_SECRET_KEY` / legacy `SUPABASE_SERVICE_ROLE_KEY`; it bypasses RLS.)
6. **Phase gates live in triggers AND policies**, on purpose. RLS policies check `sessions.phase = 'round1'` on insert, and triggers re-check on `BEFORE INSERT OR UPDATE`. Don't drop one thinking the other covers it — they handle different threat models (RLS = user-facing; triggers = admin ops that bypass RLS via the secret key).
7. **Triggers that enforce cross-user invariants must be `SECURITY DEFINER`** (with `search_path = public` pinned). `enforce_round2_cap` checks "is this topic a Round-1 survivor?" by scanning `round1_votes` across all users — if the trigger runs as `SECURITY INVOKER`, RLS clamps that scan to the caller's own picks and the check fires falsely for legitimate votes. Any new trigger that reads other users' rows needs the same treatment.
8. **`topics.submitter` is column-hidden from `authenticated`.** The grant on `public.topics` deliberately excludes `submitter` so voters can't see who submitted each topic mid-round. It's surfaced only through `SECURITY DEFINER` functions (`get_results`, admin-side reads). Do not add a blanket `grant select on public.topics` — keep it column-scoped.
9. **`service_role` needs explicit grants.** Adding a new table/view/sequence? Mirror the `authenticated` grants with matching `grant ... to service_role` statements; the admin client uses the service role and will otherwise `permission denied` from a server action.

### Adding a policy (copy-paste template)

```sql
alter table public.<table> enable row level security;

drop policy if exists <policy_name> on public.<table>;
create policy <policy_name> on public.<table>
  for <action> to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant <action> on public.<table> to authenticated;
```

## Schema-change workflow

1. Iterate via `execute_sql`. Verify behaviour with a self-asserting `do $$ ... $$` block that `raise exception`s on unexpected row counts; prefer this over manual poking because it is rerunnable and leaves a clear pass/fail.
2. Run `get_advisors` (security + performance). Fix all `WARN` items.
3. Mirror the final SQL into `supabase/migrations/0001_init.sql` (or a new `0002_*.sql` if additive).
4. Run `apply_migration` so the migration row is recorded AND the migration file matches.
5. Re-run `get_advisors`.

If you forget step 3, `supabase db pull` will produce confusing diffs — schema and migrations will drift. The skill `supabase` warns about this explicitly.

## Phase state machine

Phases: `setup → round1 → round2 → results → archived` (plus "reopen" transitions that go backwards). Only place that defines legal transitions: `LEGAL_TRANSITIONS` in [`src/app/actions/admin.ts`](src/app/actions/admin.ts). The admin UI's button list (`NEXT_ACTIONS` in [`src/app/admin/page.tsx`](src/app/admin/page.tsx)) must stay consistent with it; the **primary** (forward) action is rendered in purple and placed to the right of any "back" actions.

If you add a phase, update **all** of:

1. The `session_phase` enum in SQL (via `alter type ... add value`).
2. `Phase` type + `PHASE_LABEL` in [`src/lib/session.ts`](src/lib/session.ts).
3. `LEGAL_TRANSITIONS` and `NEXT_ACTIONS`.
4. Copy in `PHASE_COPY` (admin) and `COPY` (landing page) — including a loggedIn/loggedOut pair.
5. Trigger/policy phase guards that reference `= 'round1'` / `= 'round2'`.

## Ballot invariants

These are UX invariants *and* backend invariants — enforce them in both places or the UI will lie.

- **Round 1 ballot must contain exactly 3 distinct topics.** Frontend disables save until 3 are picked; [`src/app/actions/vote.ts`](src/app/actions/vote.ts) re-checks via `zod .refine` (distinct length = 3).
- **Round 2 ballot must total exactly 10 votes.** Frontend disables save until `sum(weights) === 10`; server re-checks via `.refine` and the `enforce_round2_cap` trigger clamps per-user totals at the DB layer.
- Weights in `round2_votes.weight` are `smallint` in `[1, 10]`. Zero-weight rows are not stored; if a user drops a topic to 0, we delete the row.

## Server-action patterns

All server actions follow the same shape:

```ts
"use server";
import { requireAdmin } from "@/lib/admin";
import { rateLimit } from "@/lib/rate-limit";

export async function someAdminAction(formData: FormData) {
  const admin = await requireAdmin();
  const limit = rateLimit(`admin:${admin.id}:some_action`);
  if (!limit.allowed) throw new Error(/* ... */);

  const parsed = someZodSchema.parse({ /* fields from formData */ });
  // ... do the thing using createAdminClient() if privileged, otherwise
  // createClient() (SSR) which respects RLS as the signed-in user.

  revalidatePath("/admin");
}
```

Voting actions use the non-privileged `createClient()` from `@/lib/supabase/server` — RLS + triggers are what enforce correctness. Keep it that way; don't "simplify" voting by switching to the admin client (it would bypass the very checks that make one-vote-per-user safe).

## Shared UI helpers

These exist because the same mistakes kept repeating in scattered JSX. **Use them instead of re-implementing the behaviour locally.**

- [`src/lib/pluralize.ts`](src/lib/pluralize.ts) — `pluralize(n, singular, plural?)`. Always use when rendering counts: "1 vote" vs "2 votes", "1 pick" vs "3 picks", "1 participant" vs "4 participants". A PR that hard-codes `"votes"` next to a count will be wrong eventually.
- [`src/lib/formatTopicDisplay.ts`](src/lib/formatTopicDisplay.ts) — `formatTopicDisplay(text)`. Imported sheet rows often arrive lowercase with weird spacing; this trims, collapses whitespace, and sentence-cases. Apply it anywhere `topic_text` is rendered to a user (admin, ballots, results, preview lists). Never store the formatted version — keep the DB value verbatim.
- [`src/lib/resultsVisual.ts`](src/lib/resultsVisual.ts) — `voteStrength`, `resultCardStyle`, `voteBarStyle`, `voteBarWidthPercent`, `resultRankClass`. Styles are keyed off vote **strength** (normalized 0–1 across the shown set), not rank index — keeps the visual hierarchy meaningful when there are ties or a small field.
- [`src/components/BrandMark.tsx`](src/components/BrandMark.tsx) — the logo (`size="sm"` in the nav, `size="lg"` on the empty-state hero). One source of truth for the wordmark; don't re-render "Music League / Topic Voting" inline anywhere else.
- [`src/components/BackToHomeLink.tsx`](src/components/BackToHomeLink.tsx) — the one purple "Back to home" link, exported alongside `backToHomeLinkClassName` if you need the styles on a different element.
- `PHASE_LABEL` in [`src/lib/session.ts`](src/lib/session.ts) — human-readable phase strings ("Round 1", "Results", …). Use this everywhere we surface `session.phase` to a user.

## Public (logged-out) session data

Anonymous visitors need to see *which phase* is active so the landing page can say "Round 1 is in progress, sign in to vote" — but we don't want to grant `anon` a blanket `select` on `sessions` (it exposes `sheet_url` and admin-ish metadata). The pattern:

- `public.get_public_session()` is a `SECURITY DEFINER` RPC that returns `{ id, name, phase, created_at }` for the active session (omits `sheet_url`).
- [`getPublicSession()`](src/lib/session.ts) wraps that RPC; the landing page uses it for logged-out users.
- Logged-in server components should prefer `getActiveSession()` which reads `sessions` directly under RLS.

If you add another field that logged-out users need, extend the RPC's return type explicitly — don't loosen the grant.

## Rate limiting

[`src/lib/rate-limit.ts`](src/lib/rate-limit.ts) is an in-process token bucket. That's fine for the single-admin small-group use case; it's **not** multi-instance safe. If we ever deploy to Vercel with more than one region or move to a load-balanced host, swap to Upstash or Redis.

## Google Sheet ingestion

[`src/lib/sheet.ts`](src/lib/sheet.ts):

- `sheetUrlSchema` — zod validator. Only `docs.google.com/spreadsheets/d/<ID>...` URLs pass.
- `toCsvExportUrl` — rewrites to the public CSV export endpoint.
- `fetchAndParseSheet` — 10 s timeout, 1 MB cap, papaparse with header inference. Column names matched case-insensitively (and via substring) against a few synonyms (`topic`, `idea`, `suggestion`, `prompt` / `submitter`, `name`, `who`, `from`, `author`). `SKIP_HEADER_KEYWORDS` filters out obvious junk columns like `timestamp`, `email address`, etc.
- `pickColumn` will not reuse the same column for topic and submitter. Real sheets from the group have a timestamp + email + topic + submitter layout; the picker has been tuned specifically to survive that.

If you need to support more column names, extend `pickColumn` candidates (and likely `SKIP_HEADER_KEYWORDS`). If you need to support non-Google sources, update `SHEET_URL_REGEX` AND widen the host allowlist in the comments — but think hard before loosening this.

Manual topic entry is also supported via `addManualTopic` in [`src/app/actions/admin.ts`](src/app/actions/admin.ts); it uses the same normalization + duplicate check as the CSV import so the two entry points can't diverge.

## Running checks locally

```bash
npx tsc --noEmit     # type-check only
npx eslint .         # lint
npx next build       # full build (proxy + route types)
```

Expect `unused_index` INFO advisors while tables are empty; those go away once real queries run. Any `WARN` or `ERROR` level advisor is a bug.

## Security checklist when touching auth / RLS / admin code

- [ ] `requireAdmin()` at top of every mutating admin action
- [ ] `auth.uid()` wrapped in `(select auth.uid())` inside new policies
- [ ] Grants to `authenticated` added alongside new tables/views (and matching `service_role` grants)
- [ ] `security_invoker = true` on new views
- [ ] New triggers that read rows belonging to *other* users are `SECURITY DEFINER` with `set search_path = public`
- [ ] New secret-key-backed reads do **not** accidentally return data to the browser (check: is the value reachable from a server component's render output?)
- [ ] No `NEXT_PUBLIC_` prefix on anything that touches the secret key or admin config
- [ ] CSP in [`next.config.ts`](next.config.ts) still covers any new external domains you fetch from
- [ ] `get_advisors` is clean (security + performance)

## What you should NOT do

- Don't install shadcn/ui — Tailwind v4 setup differs, and the project's hand-rolled primitives are intentionally small. Extend `src/components/` instead.
- Don't add client-side Supabase auth polling — `proxy.ts` already refreshes on every request.
- Don't create a second active session — the partial unique index on `sessions.archived_at IS NULL` will reject it, and the admin flow already enforces this.
- Don't store votes or phases in `localStorage` — the server is the source of truth.
- Don't commit `.env.local`.
- Don't re-implement vote grammar (`votes`/`vote`, `picks`/`pick`, `participants`/`participant`) inline; use `pluralize`.
- Don't re-format topic display text inline; use `formatTopicDisplay`.
- Don't add a "Results" link to the nav — the results page is reachable from the landing CTA when `phase = results`; the nav bar is deliberately minimal.
- Don't rewrite the wordmark/logo inline — edit `BrandMark` instead so nav and hero stay in sync.
