import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

// Alerts v2 go-live (PE-2627): the new episode-matches endpoint is public and the old history endpoint is marked
// deprecated, pointing at it.
const spec = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf-8')) as {
  paths: Record<string, Record<string, { operationId: string; deprecated?: boolean; description?: string }>>;
};

describe('alerts endpoints in openapi.json', () => {
  test('GET /api/v1/alerts/matches is documented and not deprecated', () => {
    const op = spec.paths['/api/v1/alerts/matches']?.get;
    expect(op?.operationId).toBe('getAlertEpisodeMatches');
    expect(op?.deprecated).toBeUndefined();
  });

  test('GET /api/v1/alerts/history is deprecated and names its replacement', () => {
    const op = spec.paths['/api/v1/alerts/history']?.get;
    expect(op?.deprecated).toBe(true);
    expect(op?.description).toContain('Use GET /api/v1/alerts/matches instead.');
  });
});
