import Link from "next/link";

/** Accent (purple) text link — use everywhere we show “Back to home” so it stays consistent. */
export const backToHomeLinkClassName =
  "text-sm text-[color:var(--color-accent)] hover:underline";

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
