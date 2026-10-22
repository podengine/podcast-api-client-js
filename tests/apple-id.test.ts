import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

// PE-5008: every Apple id in a response is a JSON integer (int64), never `number` (the Python SDK read that as a
// float) and never a string. Walks the committed spec so a new endpoint cannot drift back.
const spec = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf-8')) as {
  paths: Record<string, Record<string, { responses?: unknown }>>;
};

type Found = { where: string; schema: Record<string, unknown> };

const collectAppleIdSchemas = (node: unknown, where: string, out: Found[]): void => {
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectAppleIdSchemas(item, `${where}/${i}`, out));
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const properties = obj.properties as Record<string, Record<string, unknown>> | undefined;
  if (properties) {
    for (const [name, schema] of Object.entries(properties)) {
      if (name === 'appleId') out.push({ where: `${where}.${name}`, schema });
      if (name === 'notFoundAppleIds') out.push({ where: `${where}.${name}[]`, schema: schema.items as never });
      const appleProperties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      if (name === 'apple' && appleProperties?.id) out.push({ where: `${where}.apple.id`, schema: appleProperties.id });
    }
  }
  for (const [key, value] of Object.entries(obj)) collectAppleIdSchemas(value, `${where}/${key}`, out);
};

const isInt64 = (schema: Record<string, unknown>): boolean => {
  const variants = (schema.anyOf as Record<string, unknown>[] | undefined) ?? [schema];
  const nonNull = variants.filter((v) => v.type !== 'null');
  return (
    nonNull.length > 0 &&
    nonNull.every((v) => {
      const types = Array.isArray(v.type) ? v.type.filter((t) => t !== 'null') : [v.type];
      return types.length === 1 && types[0] === 'integer' && v.format === 'int64';
    })
  );
};

describe('Apple ids in responses', () => {
  const found: Found[] = [];
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) collectAppleIdSchemas(op.responses, `${method} ${path}`, found);
  }

  test('the spec has appleId response fields, including both search endpoints', () => {
    const where = found.map((f) => f.where).join('\n');
    expect(where).toContain('post /api/v1/search/episodes');
    expect(where).toContain('post /api/v1/search/podcasts');
    expect(where).toContain('get /api/v1/podcasts/{podcastIdOrSlug}');
    expect(where).toContain('.apple.id');
  });

  test('every response appleId is an int64 integer', () => {
    expect(found.filter((f) => !isInt64(f.schema)).map((f) => f.where)).toEqual([]);
  });

  test('the appleId lookup parameter is an int64 integer', () => {
    const lookup = spec.paths['/api/v1/podcasts/id/lookup']?.get as { parameters: { name: string; schema: never }[] };
    const param = lookup.parameters.find((p) => p.name === 'appleId');
    expect(param && isInt64(param.schema)).toBe(true);
  });
});
