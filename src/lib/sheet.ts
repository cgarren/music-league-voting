import Papa from "papaparse";
import { z } from "zod";

const SHEET_URL_REGEX =
  /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)(?:\/[^?#]*)?(?:[?#].*)?$/;
const GID_REGEX = /[?#&]gid=([0-9]+)/;

export const sheetUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((u) => SHEET_URL_REGEX.test(u), {
    message:
      "URL must be a Google Sheets link like https://docs.google.com/spreadsheets/d/<ID>/...",
  });

const MAX_BYTES = 1_000_000; // 1 MB cap — topic lists should be tiny.
const FETCH_TIMEOUT_MS = 10_000;

export type ParsedTopic = {
  topic: string;
  submitter: string;
  normalized: string;
  row: number;
};

export type ParseResult =
  | { ok: true; topics: ParsedTopic[]; headers: string[] }
  | { ok: false; error: string };

export function toCsvExportUrl(sheetUrl: string): string | null {
  const m = SHEET_URL_REGEX.exec(sheetUrl.trim());
  if (!m) return null;
  const id = m[1];
  const gidMatch = GID_REGEX.exec(sheetUrl);
  const gid = gidMatch?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

export function normalizeTopic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .trim();
}

async function fetchWithLimit(url: string): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "text/csv,*/*;q=0.1" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        `Google Sheets responded ${res.status}. Is the sheet published/shared with "anyone with the link"?`,
      );
    }
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        controller.abort();
        throw new Error("Sheet is too large (>1 MB).");
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8").decode(
      Buffer.concat(chunks.map((c) => Buffer.from(c))),
    );
  } finally {
    clearTimeout(t);
  }
}

// Header names we should never treat as topic or submitter even if they
// accidentally contain one of our keywords.
const SKIP_HEADER_KEYWORDS = [
  "timestamp",
  "time stamp",
  "date",
  "email",
  "completion",
];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function isSkippableHeader(h: string): boolean {
  const n = normalizeHeader(h);
  return SKIP_HEADER_KEYWORDS.some((k) => n.includes(k));
}

/**
 * Picks the first column whose header matches any of the given keyword
 * candidates (substring match, case-insensitive), skipping headers that look
 * like timestamps or other auto-generated Google Form fields. Returns the
 * matched value and the header key so callers can avoid reusing it.
 */
function pickColumn(
  row: Record<string, string>,
  keywords: string[],
  excludeKeys: Set<string> = new Set(),
): { value: string; key: string } | undefined {
  const keys = Object.keys(row).filter(
    (k) => !excludeKeys.has(k) && !isSkippableHeader(k),
  );
  for (const kw of keywords) {
    const hit = keys.find((k) => normalizeHeader(k).includes(kw));
    if (hit && row[hit]?.trim()) return { value: row[hit], key: hit };
  }
  return undefined;
}

function pickFallbackText(
  row: Record<string, string>,
  excludeKeys: Set<string>,
): { value: string; key: string } | undefined {
  for (const [k, v] of Object.entries(row)) {
    if (excludeKeys.has(k) || isSkippableHeader(k)) continue;
    if (v && v.trim()) return { value: v, key: k };
  }
  return undefined;
}

export async function fetchAndParseSheet(sheetUrl: string): Promise<ParseResult> {
  const parsed = sheetUrlSchema.safeParse(sheetUrl);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid URL" };
  }
  const csvUrl = toCsvExportUrl(parsed.data);
  if (!csvUrl) return { ok: false, error: "Could not extract sheet id" };

  let csv: string;
  try {
    csv = await fetchWithLimit(csvUrl);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsedCsv = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (parsedCsv.errors.length) {
    return {
      ok: false,
      error: `CSV parse error: ${parsedCsv.errors[0].message}`,
    };
  }
  const rows = parsedCsv.data ?? [];
  const headers = parsedCsv.meta.fields ?? [];

  const topics: ParsedTopic[] = [];
  rows.forEach((row, i) => {
    const used = new Set<string>();

    const topicHit =
      pickColumn(row, ["topic", "idea", "suggestion", "prompt", "theme"], used) ??
      pickFallbackText(row, used);
    if (!topicHit) return;
    used.add(topicHit.key);

    const submitterHit = pickColumn(
      row,
      ["submitter", "submitted by", "who", "name", "from", "author", "person"],
      used,
    );
    if (submitterHit) used.add(submitterHit.key);

    const cleaned = topicHit.value.trim();
    if (!cleaned) return;
    topics.push({
      topic: cleaned,
      submitter: (submitterHit?.value ?? "").trim(),
      normalized: normalizeTopic(cleaned),
      row: i + 2, // +1 for header, +1 for 1-indexed
    });
  });

  return { ok: true, topics, headers };
}
