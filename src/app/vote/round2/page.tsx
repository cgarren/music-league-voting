import { createClient } from "@/lib/supabase/server";
import { BackToHomeLink } from "@/components/BackToHomeLink";
import { getActiveSession, PHASE_LABEL } from "@/lib/session";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { Round2Ballot } from "./Round2Ballot";

type BallotTopic = {
  topic_id: string;
  topic_text: string;
};

export default async function Round2Page() {
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
          <GoogleSignInButton next="/vote/round2" />
        </div>
      </div>
    );
  }

  if (!session || session.phase !== "round2") {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="text-3xl font-semibold">Round 2 is not open</h1>
        <p className="mt-3 text-pretty text-sm text-[color:var(--color-muted)]">
          {session
            ? `Current phase: ${PHASE_LABEL[session.phase]}.`
            : "No active session."}
        </p>
        <BackToHomeLink className="mt-6" />
      </div>
    );
  }

  const { data: ballot } = await supabase.rpc("get_round2_ballot", {
    p_session_id: session.id,
  });

  const { data: existing } = await supabase
    .from("round2_votes")
    .select("topic_id, weight")
    .eq("session_id", session.id)
    .eq("user_id", user.id);

  return (
    <Round2Ballot
      sessionId={session.id}
      topics={(ballot ?? []) as BallotTopic[]}
      existing={Object.fromEntries(
        (existing ?? []).map((v) => [v.topic_id, v.weight]),
      )}
      deadlineAt={session.round2_deadline_at}
      deadlineTimezone={session.deadline_timezone}
    />
  );
}
