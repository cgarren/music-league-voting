/**
 * Single place to normalize topic *display* text (imported rows often arrive
 * all-lowercase with odd spacing). Call sites pass raw `topic_text` from the
 * DB; never duplicate this logic elsewhere.
 */
export function formatTopicDisplay(text: string): string {
  const s = text.trim().replace(/\s+/g, " ");
  if (!s) return s;
  const c0 = s[0];
  if (/[a-z]/.test(c0)) {
    return c0.toLocaleUpperCase() + s.slice(1);
  }
  return s;
}
