# Music League Topic Voting

A small two-round voting app that turns a Google-Sheet pile of topic
suggestions into the season's Music League prompts.

- **Round 1 — pick 3.** Signed-in users check exactly three topics they
  would love to vote songs on. Don't see yours? Suggest your own from the
  bottom of the ballot — it counts as one of your three picks. Any topic
  that gets ≥ 1 vote moves forward.
- **Round 2 — spend 10 votes.** Voters distribute exactly 10 stackable
  votes across Round 1 survivors. Stack all ten on your favorite, or spread
  them thin — your call. Submitters stay hidden during voting; vote for the
  idea, and exact wording is settled later.
- **Results.** The top finishers by vote total (with submitters revealed),
  plus the next ten as "runners up". The admin sets how many leading topics
  appear on the results page (1–50) from the dashboard; topics with zero votes
  are hidden from both lists.

One vote per Google account, one admin at a time, phases advanced manually
from a small admin page.

## Stack

- [Next.js 16 App Router](https://nextjs.org/) (TypeScript, server actions)
- [Supabase](https://supabase.com/) — Postgres, Auth (Google OAuth), RLS
- [@supabase/ssr](https://www.npmjs.com/package/@supabase/ssr) for SSR cookies
- Tailwind v4, zod, papaparse

## How voting flows 

```mermaid
flowchart LR
  Sheet[Google Sheet or manual entry] -->|admin fetch + preview| Topics
  R1Vote -.->|user-suggested topic| Topics
  Topics -->|phase: round1| R1Vote["User picks exactly 3 (may include their own suggestion)"]
  R1Vote -->|any vote count >= 1| Survivors[Round 1 survivors]
  Survivors -->|phase: round2| R2Vote["User distributes 10 votes (stackable)"]
  R2Vote -->|phase: results| Published["Published results (admin-set podium + 10 runners up)"]
```

The admin advances each phase manually from the admin page; voters can
edit their ballots until the phase closes. Only one session is active at
a time; archiving one is a prerequisite for starting the next.

## Data model

```mermaid
erDiagram
  sessions ||--o{ topics : has
  sessions ||--o{ round1_votes : has
  sessions ||--o{ round2_votes : has
  topics   ||--o{ round1_votes : receives
  topics   ||--o{ round2_votes : receives
  users    ||--o{ round1_votes : casts
  users    ||--o{ round2_votes : casts
```

- `sessions` — one active at a time (partial unique index on `archived_at IS NULL`); `phase` enum drives gating.
- `topics` — imported from the sheet **or contributed by a voter from the Round 1 ballot**; `normalized_text` powers duplicate hints; `submitted_by` (nullable FK to `auth.users`) tags voter-contributed rows and is partial-unique per session so each voter has at most one live suggestion.
- `round1_votes` — PK `(user_id, topic_id)`; trigger caps at 3 per user per session. Submission goes through the `submit_round1_ballot` SECURITY DEFINER RPC so the optional user-suggested topic and the three vote inserts share a single transaction.
- `round2_votes` — same PK plus `weight smallint`; trigger caps total weight at 10 and requires the topic to be a Round 1 survivor.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values (see below)
npm run dev
```

The app reads these environment variables:

| Name                                   | Scope      | Purpose                                 |
| -------------------------------------- | ---------- | --------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | public     | Supabase project URL                    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public     | Publishable API key (browser)           |
| `SUPABASE_SECRET_KEY`                  | **server** | Privileged admin ops — never ship to FE |
| `ADMIN_EMAILS`                         | **server** | Comma-separated list of admin emails    |

`.env.local` is in `.gitignore`. Never check the secret key in.

> The secret key (`sb_secret_...`) is Supabase's current-gen backend
> credential and replaces the legacy `service_role` JWT. Create one in
> **Project Settings → API Keys → Secret keys → Create new secret key**.
> If you already have the legacy `SUPABASE_SERVICE_ROLE_KEY` set, the code
> will keep working — but prefer rotating to the new format.

## Supabase setup

1. **Project**: reuse the existing project or run `supabase projects create`.
2. **Schema**: apply the migration in [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) via the Supabase dashboard SQL editor, or with the CLI:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
3. **Google OAuth**:
   - In the Supabase dashboard → **Authentication → Providers → Google**,
     toggle **Enabled** and paste in Google OAuth Client ID + Secret.
   - In Google Cloud Console → OAuth consent screen, set the app scope to
     `openid`, `email`, `profile`.
   - Add these authorised redirect URIs in Google Cloud:
     - `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - Add these site / redirect URLs in Supabase Auth settings:
     - `http://localhost:3000`
     - `https://<your-production-domain>`
     - `https://<your-production-domain>/auth/callback`
4. **Keep JWT expiry short** (e.g. 1 hour) under Auth → Sessions.

## Admin workflow

1. Set `ADMIN_EMAILS=you@example.com` (comma-separated for multiple admins).
2. Sign in with Google. If no session is active, the landing page shows an
   admin-oriented Google sign-in prompt; once signed in, an **Admin** link
   appears in the navbar.
3. Click **Admin** → **Start session** and give it a name.
4. Add topics via either (or both) entry point:
   - **Google Sheet** — paste a shared link (*anyone with the link — Viewer*),
     hit **Fetch from sheet**, uncheck duplicates/noise, then **Import**.
     Topic and submitter columns are matched by header name; timestamp /
     email columns are skipped automatically.
   - **Manual entry** — type a topic (and optionally a submitter) and click
     **Add**. Topic text is normalized (trim, collapse whitespace, sentence
     case) on display, and duplicates are rejected either way.
5. Click **Open Round 1** → voters see `/vote/round1`. Voters can also
   add their own topic from the bottom of the ballot — it slots into the
   list for everyone else and counts as one of the suggester's 3 picks.
6. When ready, click **Close Round 1 → Open Round 2**.
7. When ready, click **Close Round 2 → Publish Results**.
8. If needed, **Reopen Round 2** hides results and lets voters edit again.
9. **Archive & Start Fresh** lets you run the next session.

## Security

- Row-Level Security enabled on every public table, with per-user policies
  scoped to `auth.uid()` and the current session phase.
- `sessions` and `topics` are writable only via the Supabase secret key,
  which is gated by `requireAdmin()` (server-side email check against
  `ADMIN_EMAILS`) before any mutating server action runs.
- `auth.jwt()` / `user_metadata` are **never** used for authorisation —
  they're user-editable.
- Results exposed via a `SECURITY DEFINER` function that refuses to return
  rows until the admin flips the session to `results`, so per-user ballots
  remain private even from the results page.
- Topic submitters are hidden from voters during Round 1 and Round 2. The
  Round 2 ballot RPC returns only topic IDs and text; submitters are revealed
  only once results are published.
- Google Sheet fetcher enforces host allowlist, timeout, and a 1 MB cap.
- Admin server actions are rate-limited per user (in-memory token bucket).
- CSP, `X-Frame-Options: DENY`, Referrer-Policy, and Permissions-Policy
  set in [`next.config.ts`](next.config.ts).

## Deploy (Vercel)

1. Push this repo to GitHub and import into Vercel.
2. Add the four env vars above to the Vercel project.
3. After the first deploy, add your Vercel URL as a valid site URL in
   Supabase Auth → URL Configuration.

## Handy commands

```bash
npm run dev         # local dev
npm run build       # production build
npm run lint        # eslint
npx tsc --noEmit    # typecheck
```

## Project layout

```
src/
  app/            # routes (admin, vote/round1, vote/round2, results, auth)
  components/     # shared UI (BrandMark, BackToHomeLink, GoogleSignInButton)
  lib/            # Supabase clients + domain helpers (session, sheet, pluralize, …)
  proxy.ts        # Next.js 16 proxy — refreshes the Supabase session cookie
supabase/
  migrations/
    0001_init.sql                 # canonical schema: tables, RLS, triggers, RPCs
    0002_user_round1_topics.sql   # adds submitted_by + submit_round1_ballot RPC
    0003_round2_blind_voting.sql  # strips submitter from the Round 2 ballot RPC
```

See [`AGENTS.md`](AGENTS.md) for the full file-by-file breakdown and the
engineering conventions (schema invariants, shared helpers, ballot rules,
security checklist) that aren't obvious from the source.

## License

MIT. See [`LICENSE`](LICENSE) if/when added.
