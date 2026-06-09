import { describe, expect, test } from 'bun:test';

import { buildSearchParams, hydrateDates } from '../src/core/transform';

describe('hydrateDates', () => {
  test('converts ISO date-time strings to Date instances', () => {
    const out = hydrateDates({ publishedAt: '2024-01-31T12:00:00.000Z' }) as { publishedAt: Date };
    expect(out.publishedAt).toBeInstanceOf(Date);
    expect(out.publishedAt.toISOString()).toBe('2024-01-31T12:00:00.000Z');
  });

  test('leaves non-ISO strings untouched', () => {
    const out = hydrateDates({ date: '2024-01-31', name: 'hello' }) as Record<string, unknown>;
    expect(out.date).toBe('2024-01-31');
    expect(out.name).toBe('hello');
  });

  test('recurses into nested objects and arrays', () => {
    const out = hydrateDates({
      items: [{ at: '2020-06-01T00:00:00.000Z' }, { at: 'not-a-date' }],
    }) as { items: Array<{ at: unknown }> };
    expect(out.items[0]!.at).toBeInstanceOf(Date);
    expect(out.items[1]!.at).toBe('not-a-date');
  });

  test('handles primitives and null', () => {
    expect(hydrateDates(null)).toBeNull();
    expect(hydrateDates(42)).toBe(42);
    expect(hydrateDates('2024-01-31T12:00:00.000Z')).toBeInstanceOf(Date);
  });
});

describe('buildSearchParams', () => {
  test('serializes primitives', () => {
    const params = buildSearchParams({ a: 'x', b: 2, c: true });
    expect(params.toString()).toBe('a=x&b=2&c=true');
  });

  test('repeats array values', () => {
    expect(buildSearchParams({ id: ['a', 'b'] }).toString()).toBe('id=a&id=b');
  });

  test('skips null and undefined (including inside arrays)', () => {
    const params = buildSearchParams({ a: null, b: undefined, c: 'keep', d: ['x', null as never, undefined as never] });
    expect(params.toString()).toBe('c=keep&d=x');
  });

  test('serializes Date as ISO string', () => {
    const params = buildSearchParams({ since: new Date('2024-01-31T12:00:00.000Z') });
    expect(params.get('since')).toBe('2024-01-31T12:00:00.000Z');
  });
});
