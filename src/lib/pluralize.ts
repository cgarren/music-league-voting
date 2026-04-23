/**
 * English count nouns: 0 and 2+ use the plural; only 1 uses the singular.
 */
export function pluralize(
  n: number,
  singular: string,
  plural: string,
): string {
  return n === 1 ? singular : plural;
}
