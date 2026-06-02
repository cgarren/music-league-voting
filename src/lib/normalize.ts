/**
 * Normalizes topic text for comparison and unique constraint checks in the database.
 * Converts to lowercase, collapses consecutive whitespace, and removes non-alphanumeric characters.
 */
export function normalizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .trim();
}
