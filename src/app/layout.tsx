import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { getAdminUser } from "@/lib/admin";
import { signOut } from "@/app/actions/auth";
import { BrandMark } from "@/components/BrandMark";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Music League Topic Voting",
  description:
    "Vote on weekly Music League topics: pick your favorites, then rank the top ten.",
};

async function NavBar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = await getAdminUser();

  return (
    <header className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]/70 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          aria-label="Music League Topic Voting — home"
          className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/60"
        >
          <BrandMark size="sm" />
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {admin ? (
            <Link
              href="/admin"
              className="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-[color:var(--color-foreground)] hover:border-[color:var(--color-accent)]"
            >
              Admin
            </Link>
          ) : null}
          {user ? (
            <form action={signOut}>
              <button
                type="submit"
                className="text-[color:var(--color-muted)] hover:text-[color:var(--color-foreground)]"
              >
                Sign out
              </button>
            </form>
          ) : null}
        </nav>
      </div>
    </header>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NavBar />
        <main className="flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
