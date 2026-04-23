import { createClient } from "@/lib/supabase/server";
import { BackToHomeLink } from "@/components/BackToHomeLink";
import { getActiveSession, PHASE_LABEL } from "@/lib/session";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { Round1Ballot } from "./Round1Ballot";

export default async function Round1Page() {
  const session = await getActiveSession();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="text-3xl font-semibold">Sign in to vote</h1>
        <p className="mt-3 text-sm text-[color:var(--color-muted)]">
          One vote per Google account.
        </p>
        <div className="mt-8">
          <GoogleSignInButton next="/vote/round1" />
        </div>
      </div>
    );
  }

  if (!session || session.phase !== "round1") {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="text-3xl font-semibold">Round 1 is not open</h1>
        <p className="mt-3 text-pretty text-sm text-[color:var(--color-muted)]">
          {session
            ? `Current phase: ${PHASE_LABEL[session.phase]}.`
            : "No active session."}
        </p>
        <BackToHomeLink className="mt-6" />
      </div>
    );
  }

  // Round 1 is intentionally blind: we never fetch `submitter` so voters can't
  // see who suggested each topic. The column is also ungranted to the
  // `authenticated` role, so this isn't just a UI nicety.
  const { data: topics } = await supabase
    .from("topics")
    .select("id, topic_text")
    .eq("session_id", session.id)
    .eq("removed", false)
    .order("created_at", { ascending: true });

  const { data: existingVotes } = await supabase
    .from("round1_votes")
    .select("topic_id")
    .eq("session_id", session.id)
    .eq("user_id", user.id);

  return (
    <Round1Ballot
      sessionId={session.id}
      topics={topics ?? []}
      selected={(existingVotes ?? []).map((v) => v.topic_id)}
    />
  );
}
