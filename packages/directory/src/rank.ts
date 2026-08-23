/**
 * Searching and ordering the directory.
 *
 * The comparators take `RankableFields`, not the full entry, so the ordering
 * cannot see the marketing-client flag even by accident — it is not in the type
 * that reaches this file's sorting functions.
 *
 * Ties break on slug. Not on account age, not on insertion order, not on
 * anything that a business could quietly start influencing: a stable,
 * meaningless tiebreak is the honest one.
 */
import type {
  DirectoryDimension,
  DirectoryEntry,
  DirectoryPage,
  DirectoryQuery,
  RankableFields,
  SortKey,
} from './types.ts';

export const ORDERING_NOTE =
  'Ordered by the rubric alone. Placement in this directory is not for sale, and nothing on this page is advertising.';

export const DEFAULT_PAGE_SIZE = 24;

const DIMENSIONS: readonly DirectoryDimension[] = [
  'functional_integrity',
  'security_posture',
  'data_privacy_practice',
  'practicality_ux',
  'production_readiness',
  'store_distribution_readiness',
];

export function isSortKey(value: string): value is SortKey {
  return (
    value === 'score' || value === 'recent' || (DIMENSIONS as readonly string[]).includes(value)
  );
}

function dimensionScore(entry: RankableFields, dimension: DirectoryDimension): number {
  return entry.dimensions.find((score) => score.dimension === dimension)?.score ?? -1;
}

/** Every comparator is a pure function of rubric output and the slug. */
function comparatorFor(sort: SortKey): (a: RankableFields, b: RankableFields) => number {
  if (sort === 'recent') {
    return (a, b) => b.assessedOn.localeCompare(a.assessedOn) || a.slug.localeCompare(b.slug);
  }
  if (sort === 'score') {
    return (a, b) => b.score - a.score || a.slug.localeCompare(b.slug);
  }
  return (a, b) =>
    dimensionScore(b, sort) - dimensionScore(a, sort) || a.slug.localeCompare(b.slug);
}

function normalise(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Search matches the name, the origin, the category and the owner's tagline.
 *
 * Not the findings, and not the report. Those belong to the customer, and a
 * directory that let anyone search for "applications with an open critical
 * finding" would be a directory that punishes people for being assessed.
 */
export function matches(entry: DirectoryEntry, search: string): boolean {
  const needle = normalise(search);
  if (!needle) return true;
  const haystack = normalise(
    [entry.name, entry.certifiedOrigin, entry.category ?? '', entry.tagline ?? ''].join(' '),
  );
  return needle
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export function queryDirectory(
  entries: readonly DirectoryEntry[],
  query: DirectoryQuery = {},
): DirectoryPage {
  const sort: SortKey = query.sort && isSortKey(query.sort) ? query.sort : 'score';
  const pageSize = Math.min(Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1), 100);
  const page = Math.max(query.page ?? 1, 1);

  const filtered = entries.filter((entry) => {
    if (query.search && !matches(entry, query.search)) return false;
    if (query.category && normalise(entry.category ?? '') !== normalise(query.category)) {
      return false;
    }
    if (typeof query.minScore === 'number' && entry.score < query.minScore) return false;
    return true;
  });

  // Sorted through the narrow view, then mapped back. The comparator never
  // holds a reference to anything but the four rankable fields.
  const ordered = filtered
    .map((entry, index) => ({
      index,
      rankable: {
        slug: entry.slug,
        score: entry.score,
        assessedOn: entry.assessedOn,
        dimensions: entry.dimensions,
      } satisfies RankableFields,
    }))
    .sort((a, b) => comparatorFor(sort)(a.rankable, b.rankable))
    .map((item) => filtered[item.index]!);

  const start = (page - 1) * pageSize;
  return {
    entries: ordered.slice(start, start + pageSize),
    total: ordered.length,
    page,
    pageSize,
    sort,
    orderingNote: ORDERING_NOTE,
  };
}

export function categoriesOf(entries: readonly DirectoryEntry[]): string[] {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.category) continue;
    const key = normalise(entry.category);
    if (!seen.has(key)) seen.set(key, entry.category);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export { DIMENSIONS };
