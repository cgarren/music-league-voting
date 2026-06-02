import { normalizeTopic } from "./normalize";

/**
 * Generates character trigrams for a normalized string.
 */
function getTrigrams(str: string): Set<string> {
  const trigrams = new Set<string>();
  const cleaned = str.replace(/\s+/g, ""); // Remove spaces for character-level trigrams
  if (cleaned.length < 3) {
    // Fallback to bigrams or single characters if very short
    for (let i = 0; i < cleaned.length - 1; i++) {
      trigrams.add(cleaned.substring(i, i + 2));
    }
    if (cleaned.length === 1) {
      trigrams.add(cleaned);
    }
    return trigrams;
  }
  for (let i = 0; i < cleaned.length - 2; i++) {
    trigrams.add(cleaned.substring(i, i + 3));
  }
  return trigrams;
}

/**
 * Computes Jaccard Similarity between two sets.
 */
function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersectionSize = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionSize++;
    }
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  return intersectionSize / unionSize;
}

/**
 * Splits a normalized string into words.
 */
function getWordSet(str: string): Set<string> {
  return new Set(str.split(" ").filter(Boolean));
}

/**
 * Computes Containment Similarity: |A ∩ B| / min(|A|, |B|)
 */
function containmentSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersectionSize = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionSize++;
    }
  }
  return intersectionSize / Math.min(setA.size, setB.size);
}

export type SimilarityMatch<T> = {
  item: T;
  score: number;
};

/**
 * Calculates the similarity score between two strings, from 0 to 1.
 */
export function computeSimilarity(a: string, b: string): number {
  const normA = normalizeTopic(a);
  const normB = normalizeTopic(b);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  // 1. Character Trigram Similarity (catches typos, small variations, plurals)
  const trigramsA = getTrigrams(normA);
  const trigramsB = getTrigrams(normB);
  const trigramScore = jaccardSimilarity(trigramsA, trigramsB);

  // 2. Word-level Similarity (catches word ordering)
  const wordsA = getWordSet(normA);
  const wordsB = getWordSet(normB);
  const wordScore = jaccardSimilarity(wordsA, wordsB);

  // 3. Word-level Containment Similarity (catches substrings / additions)
  // Only apply containment if the shorter query has at least 2 words to avoid trivial matches
  let containmentScore = 0;
  if (Math.min(wordsA.size, wordsB.size) >= 2) {
    containmentScore = containmentSimilarity(wordsA, wordsB);
  }

  // Return the best matching score across the metrics, discounting containment slightly
  return Math.max(trigramScore, wordScore, containmentScore * 0.85);
}

/**
 * Finds all items in existingList that are similar to the query above the threshold.
 */
export function findSimilarItems<T>(
  query: string,
  existingList: T[],
  getText: (item: T) => string,
  threshold = 0.6
): SimilarityMatch<T>[] {
  const trimmed = query.trim();
  if (trimmed.length < 3) return []; // Don't check for extremely short inputs

  const matches: SimilarityMatch<T>[] = [];
  for (const item of existingList) {
    const text = getText(item);
    const score = computeSimilarity(trimmed, text);
    if (score >= threshold) {
      matches.push({ item, score });
    }
  }

  // Sort by highest similarity score first
  return matches.sort((a, b) => b.score - a.score);
}
