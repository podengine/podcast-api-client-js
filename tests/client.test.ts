import { describe, expect, test } from 'bun:test';

import { PodEngine } from '../src/index';

import { mockFetch } from './helpers';

const BASE = 'https://api.test';

describe('PodEngine — generated resource client (end-to-end wiring)', () => {
  test('exposes resource groups', () => {
    const pe = new PodEngine({ apiKey: 'k' });
    expect(typeof pe.charts.getLatestChart).toBe('function');
    expect(typeof pe.guestProfiles.createGuestProfile).toBe('function');
    expect(typeof pe.episodes.downloadEpisodeTranscript).toBe('function');
    expect(typeof pe.search.searchPodcasts).toBe('function');
  });

  test('query endpoint (getLatestChart) hits the right URL with query params', async () => {
    const { fetch, calls } = mockFetch([{ json: { status: 'OK', data: { chart: [] } } }]);
    const pe = new PodEngine({ apiKey: 'k', baseUrl: BASE, fetch });
    await pe.charts.getLatestChart({ chartType: 'apple', country: 'us', category: 'top podcasts' });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/api/v1/charts/latest');
    expect(calls[0]!.method).toBe('GET');
    expect(url.searchParams.get('chartType')).toBe('apple');
    expect(url.searchParams.get('category')).toBe('top podcasts');
  });

  test('path endpoint (getCategoriesByChartType) substitutes the path param', async () => {
    const { fetch, calls } = mockFetch([{ json: { data: { categories: [] } } }]);
    const pe = new PodEngine({ apiKey: 'k', baseUrl: BASE, fetch });
    await pe.charts.getCategoriesByChartType({ chartType: 'apple' });
    expect(new URL(calls[0]!.url).pathname).toBe('/api/v1/charts/apple/categories');
  });

  test('object body endpoint (createGuestProfile) POSTs a merged JSON body', async () => {
    const { fetch, calls } = mockFetch([{ json: { data: { id: 'gp_1' } } }]);
    const pe = new PodEngine({ apiKey: 'k', baseUrl: BASE, fetch });
    await pe.guestProfiles.createGuestProfile({ firstName: 'Ada', lastName: 'Lovelace', shortBio: 'Pioneer' });
    expect(calls[0]!.method).toBe('POST');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ firstName: 'Ada', lastName: 'Lovelace', shortBio: 'Pioneer' });
  });

  test('array body endpoint (updateGuestProfileSocialMediaLinks) sends body verbatim', async () => {
    const { fetch, calls } = mockFetch([{ json: { data: {} } }]);
    const pe = new PodEngine({ apiKey: 'k', baseUrl: BASE, fetch });
    await pe.guestProfiles.updateGuestProfileSocialMediaLinks({
      guestProfileId: 'gp_1',
      body: [{ socialMediaType: 'twitter', url: 'https://x.com/ada' }],
    });
    expect(new URL(calls[0]!.url).pathname).toBe('/api/v1/guest-profiles/gp_1/social-media-links');
    expect(JSON.parse(calls[0]!.body!)).toEqual([{ socialMediaType: 'twitter', url: 'https://x.com/ada' }]);
  });

  test('binary endpoint (downloadEpisodeTranscript) returns a Blob', async () => {
    const blob = new Blob(['transcript text'], { type: 'application/octet-stream' });
    const { fetch } = mockFetch([{ blob }]);
    const pe = new PodEngine({ apiKey: 'k', baseUrl: BASE, fetch });
    const result = await pe.episodes.downloadEpisodeTranscript({ episodeId: 'ep_1', format: 'txt' });
    expect(result).toBeInstanceOf(Blob);
    expect(await result.text()).toBe('transcript text');
  });
});
