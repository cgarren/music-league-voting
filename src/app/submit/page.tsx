import { createClient } from "@/lib/supabase/server";
import { BackToHomeLink } from "@/components/BackToHomeLink";
import { getActiveSession, PHASE_LABEL } from "@/lib/session";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { SubmitTopicsClient } from "./SubmitTopicsClient";

export default async function SubmitPage() {
  const session = await getActiveSession();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="text-3xl font-semibold">Sign in to suggest topics</h1>
        <p className="mt-3 text-sm text-[color:var(--color-muted)]">
          Sign in with Google to add your suggestions.
        </p>
        <div className="mt-8">
          <GoogleSignInButton next="/submit" />
        </div>
      </div>
    );
  }

  if (!session || session.phase !== "submitting") {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="text-3xl font-semibold">Submissions are closed</h1>
        <p className="mt-3 text-pretty text-sm text-[color:var(--color-muted)]">
          {session
            ? `Current phase: ${PHASE_LABEL[session.phase]}.`
            : "No active session."}
        </p>
        <BackToHomeLink className="mt-6" />
      </div>
    );
  }

  // Fetch all submissions for the active session (newest first)
  const { data: submissions } = await supabase
    .from("submissions")
    .select("id, topic_text, user_id, created_at")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false });

  return (
    <SubmitTopicsClient
      submissionCap={session.submission_cap}
      currentUserId={user.id}
      initialSubmissions={submissions ?? []}
    />
  );
}
