import { createClient } from "@/lib/supabase/server";

export type AdminUser = {
  id: string;
  email: string;
};

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns the currently-signed-in user if their email is in ADMIN_EMAILS.
 * Returns null otherwise. Safe to call from Server Components for conditional
 * UI; mutating actions should use `requireAdmin()` instead.
 */
export async function getAdminUser(): Promise<AdminUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  const allowed = adminEmails();
  if (!allowed.includes(user.email.toLowerCase())) return null;
  return { id: user.id, email: user.email };
}

/**
 * Throws if the caller is not an admin. Use at the top of every admin server
 * action or route handler.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getAdminUser();
  if (!admin) {
    throw new Error("Forbidden: admin access required");
  }
  return admin;
}

export function isAdminConfigured(): boolean {
  return adminEmails().length > 0;
}
