import Link from "next/link";

/** Accent (purple) primary button — use everywhere we show “Back to home” so it stays consistent. */
export const backToHomeLinkClassName =
  "inline-flex items-center justify-center rounded-full bg-[color:var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[color:var(--color-accent-strong)]";

export function BackToHomeLink({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={
        className
          ? `${backToHomeLinkClassName} ${className}`.trim()
          : backToHomeLinkClassName
      }
    >
      Back to home
    </Link>
  );
}
