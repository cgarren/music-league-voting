import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client bound to the caller's cookies. Use this in
 * Server Components, Server Actions, and Route Handlers. It respects RLS as
 * the authenticated user.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component where cookies cannot be set.
            // Middleware handles refresh in that case, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * Privileged Supabase client for admin operations. Authenticated with the
 * Supabase "secret key" (sb_secret_...) which bypasses RLS. NEVER expose this
 * to the browser and ALWAYS gate its use behind requireAdmin().
 *
 * The legacy name for this is the service-role JWT; any key in either format
 * works here.
 */
export function createAdminClient() {
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not configured (or legacy SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
