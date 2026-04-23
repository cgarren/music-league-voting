// In-memory token bucket for per-user admin action rate limiting. Process-
// scoped (resets on deploy / lambda cold start) — suitable for a small
// single-admin tool but NOT a production replacement for Redis / Upstash.

type Bucket = { tokens: number; lastRefill: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  { capacity = 20, refillPerMinute = 20 } = {},
): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: capacity, lastRefill: now };
  const refillRatePerMs = refillPerMinute / 60_000;
  const elapsed = now - bucket.lastRefill;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillRatePerMs);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    const retryAfterMs = Math.ceil((1 - bucket.tokens) / refillRatePerMs);
    buckets.set(key, bucket);
    return { allowed: false, retryAfterMs };
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return { allowed: true };
}
