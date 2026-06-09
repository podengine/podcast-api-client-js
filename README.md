# podengine

Official TypeScript/JavaScript SDK for the [Pod Engine](https://www.podengine.ai) podcast
intelligence API — search 4M+ podcasts, pull rich metadata, transcripts, charts, reviews,
guest profiles and more, with full type safety.

- 🟦 **Fully typed** — every method's parameters and responses are generated from the API's
  OpenAPI spec, so your editor autocompletes the entire surface.
- 🧩 **Ergonomic** — resources are grouped by domain: `pe.podcasts.getPodcast(...)`,
  `pe.charts.getLatestChart(...)`, `pe.search.searchPodcasts(...)`.
- 🪶 **Lightweight** — zero runtime dependencies. Uses the platform `fetch`.
- 🔁 **Resilient** — automatic retries with backoff for transient failures (429 / 5xx).
- 🗓️ **Smart dates** — ISO timestamps are hydrated into real `Date` objects.

## Install

```bash
npm install podengine
# or: pnpm add podengine / yarn add podengine / bun add podengine
```

Requires Node 18+ (or any runtime with a global `fetch`).

## Quick start

```ts
import { PodEngine } from 'podengine';

const pe = new PodEngine({ apiKey: process.env.PODENGINE_API_KEY! });

// Search podcasts
const { result } = await pe.search.searchPodcasts({
  searchTerms: [
    {
      searchTerm: 'startups',
      searchType: 'text',
      searchTargets: ['podcast-title', 'podcast-description'],
      searchTermOptions: { matchMode: 'optional' },
    },
  ],
});

// Get the latest Apple chart
const chart = await pe.charts.getLatestChart({
  chartType: 'apple',
  country: 'us',
  category: 'top podcasts',
});

// Fetch a podcast (by ID or slug) and its episodes
const { podcast } = await pe.podcasts.getPodcast({ podcastIdOrSlug: 'the-tim-ferriss-show' });
const episodes = await pe.podcasts.getPodcastEpisodes({ podcastIdOrSlug: podcast.id });
```

Get an API key at <https://www.podengine.ai/get-started>.

## Authentication

Pass your API key when constructing the client. It is sent on every request.

```ts
const pe = new PodEngine({ apiKey: 'pe_live_...' });
```

## Configuration

```ts
const pe = new PodEngine({
  apiKey: process.env.PODENGINE_API_KEY!,
  baseUrl: 'https://api.podengine.ai', // override for staging/self-host
  source: 'my-app',                    // sent as the x-source header for attribution
  timeout: 30_000,                     // per-request timeout in ms (default: none)
  maxRetries: 2,                       // retries for 429/5xx/network (default: 2)
  headers: { 'x-team': 'growth' },     // extra headers on every request
  fetch: customFetch,                  // inject a custom fetch implementation
});
```

Every method also accepts per-call options as a final argument:

```ts
const controller = new AbortController();
const chart = await pe.charts.getLatestChart(
  { chartType: 'apple', country: 'us', category: 'top podcasts' },
  { signal: controller.signal, timeout: 5_000, headers: { 'x-trace': '1' } }
);
```

## Examples

### Transcripts

```ts
// Plain-text transcript
const { episodeTranscriptText } = await pe.episodes.getEpisodeTranscriptText({ episodeId });
console.log(episodeTranscriptText.text);

// Download a transcript file (returned as a Blob)
const file = await pe.episodes.downloadEpisodeTranscript({ episodeId, format: 'vtt' });

// Request a transcription if one doesn't exist yet
await pe.transcriptions.requestEpisodeTranscription({ episodeId });
```

### Charts

```ts
const categories = await pe.charts.getCategoriesByChartType({ chartType: 'apple' });
const chart = await pe.charts.getChart({
  chartType: 'apple',
  country: 'us',
  category: 'top podcasts',
  date: '2024-06-01',
});
```

### Guest profiles

```ts
const profile = await pe.guestProfiles.createGuestProfile({
  firstName: 'Ada',
  lastName: 'Lovelace',
  shortBio: 'Mathematician and writer.',
});

await pe.guestProfiles.updateGuestProfileSocialMediaLinks({
  guestProfileId: profile.guestProfileId,
  body: [{ socialMediaType: 'twitter', url: 'https://x.com/ada' }],
});
```

## Error handling

All failures throw a `PodEngineError` subclass:

```ts
import { PodEngine, PodEngineApiError, PodEngineConnectionError } from 'podengine';

try {
  await pe.podcasts.getPodcast({ podcastIdOrSlug: 'does-not-exist' });
} catch (err) {
  if (err instanceof PodEngineApiError) {
    console.error(err.status);      // e.g. 404
    console.error(err.message);     // server-provided message
    console.error(err.requestId);   // x-request-id, if present
    console.error(err.body);        // raw parsed error body
  } else if (err instanceof PodEngineConnectionError) {
    console.error('Network/timeout:', err.message);
  }
}
```

## TypeScript

Parameter and response types are exported for every operation, named `<Operation>Params` and
`<Operation>Response`:

```ts
import type { SearchPodcastsParams, GetLatestChartResponse } from 'podengine';

function buildQuery(): SearchPodcastsParams {
  return {
    pageSize: 25,
    searchTerms: [
      {
        searchTerm: 'climate',
        searchType: 'text',
        searchTargets: ['podcast-title', 'podcast-description'],
        searchTermOptions: { matchMode: 'optional' },
      },
    ],
  };
}
```

The raw OpenAPI types are also available via `import type { schema } from 'podengine'`, and
the spec itself ships in the package: `import spec from 'podengine/openapi.json'`.

## Resources

`pe.agent`, `pe.alerts`, `pe.autocomplete`, `pe.charts`, `pe.episodes`, `pe.guestProfiles`,
`pe.podcasts`, `pe.polling`, `pe.projects`, `pe.search`, `pe.stats`, `pe.teams`,
`pe.transcriptions`, `pe.usage`.

See the full interactive reference at <https://www.podengine.ai/api-docs>.

## License

[MIT](./LICENSE)
