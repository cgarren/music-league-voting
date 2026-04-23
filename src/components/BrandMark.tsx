/**
 * The app logo: a purple ballot-check badge plus a stacked wordmark.
 *   Eyebrow  (purple, uppercase tracking)     : "TOPIC VOTING"
 *   Wordmark (foreground/white, bold)         : "Music League"
 *
 * Kept intentionally text-only (plus an inline SVG) so it scales with system
 * fonts and never ships a raster asset.
 */
export function BrandMark({ size = "sm" }: { size?: "sm" | "lg" }) {
    const isLg = size === "lg";
    return (
        <span
            className={`flex items-center ${isLg ? "gap-3" : "gap-2"}`}
            aria-label="Music League Topic Voting"
        >
            <span
                aria-hidden
                className={`flex flex-none items-center justify-center rounded-md bg-[color:var(--color-accent)] text-white shadow-md shadow-[color:var(--color-accent)]/30 ring-1 ring-inset ring-white/10 ${
                    isLg ? "h-12 w-12" : "h-7 w-7"
                }`}
            >
                <svg
                    viewBox="0 0 24 24"
                    className={isLg ? "h-7 w-7" : "h-4 w-4"}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={isLg ? 2.5 : 2.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M5 12.5l4 4L19 6.5" />
                </svg>
            </span>
            <span className="flex flex-col leading-none text-left">
                <span
                    className={`font-medium uppercase text-[color:var(--color-accent)] ${
                        isLg
                            ? "text-sm tracking-[0.3em]"
                            : "text-[10px] tracking-[0.22em]"
                    }`}
                >
                    Music League
                </span>
                <span
                    className={`mt-1 font-semibold tracking-tight text-[color:var(--color-foreground)] ${
                        isLg ? "text-4xl sm:text-5xl" : "text-sm"
                    }`}
                >
                    Topic Voting
                </span>
            </span>
        </span>
    );
}
