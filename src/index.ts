/**
 * Pod Engine — official TypeScript SDK.
 *
 * @example
 * ```ts
 * import { PodEngine } from 'podengine';
 *
 * const pe = new PodEngine({ apiKey: process.env.PODENGINE_API_KEY! });
 *
 * const { result } = await pe.search.searchPodcasts({
 *   searchTerms: [
 *     { searchTerm: 'startups', searchType: 'text', searchTargets: ['podcast-title'], searchTermOptions: { matchMode: 'optional' } },
 *   ],
 * });
 * const chart = await pe.charts.getLatestChart({ chartType: 'apple', country: 'us', category: 'top podcasts' });
 * ```
 */
export { PodEngine } from './generated/client';

// Per-operation parameter and response types (e.g. `SearchPodcastsParams`, `GetLatestChartResponse`).
export type * from './generated/client';

// Underlying spec types, for advanced consumers who want to reach into `operations`/`components`.
export type * as schema from './generated/schema';

export { PodEngineError, PodEngineApiError, PodEngineConnectionError } from './core/errors';
export { DEFAULT_BASE_URL, type ClientOptions, type RequestOptions, type FetchLike } from './core/client-core';
