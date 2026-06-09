/**
 * Pure runtime helpers shared by the request core: query-string serialization and
 * response date hydration. No dependencies, no internal/monorepo imports.
 */

// Matches ISO-8601 timestamps with millisecond precision and a `Z` suffix, e.g.
// `2024-01-31T12:00:00.000Z`. This mirrors how the API serializes `date-time` fields,
// which the generated types model as `Date`.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Recursively walk a parsed JSON value and convert ISO date-time strings into `Date`
 * instances in place, keeping runtime values aligned with the generated `Date` types.
 */
export const hydrateDates = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return ISO_DATE_TIME.test(value) ? new Date(value) : value;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = hydrateDates(value[i]);
    return value;
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) obj[key] = hydrateDates(obj[key]);
    return obj;
  }
  return value;
};

type QueryPrimitive = string | number | boolean | Date;
export type QueryValue = QueryPrimitive | QueryPrimitive[] | null | undefined;

const stringifyQueryPrimitive = (value: QueryPrimitive): string =>
  value instanceof Date ? value.toISOString() : String(value);

/**
 * Serialize a flat record into `URLSearchParams`. Arrays are repeated (`?id=a&id=b`),
 * `Date`s become ISO strings, and `null`/`undefined` entries are skipped.
 */
export const buildSearchParams = (query: Record<string, QueryValue>): URLSearchParams => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === null || item === undefined) continue;
        params.append(key, stringifyQueryPrimitive(item));
      }
      continue;
    }
    params.append(key, stringifyQueryPrimitive(value));
  }
  return params;
};
