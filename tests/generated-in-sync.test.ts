import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

// Guard: the committed generated client must cover every operation in the committed spec.
// If this fails, run `pnpm gen:client` (or `pnpm generate` to also refresh the spec).
const specPath = new URL('../openapi.json', import.meta.url);
const clientPath = new URL('../src/generated/client.ts', import.meta.url);

const spec = JSON.parse(readFileSync(specPath, 'utf-8')) as {
  paths: Record<string, Record<string, { operationId: string }>>;
};
const clientSource = readFileSync(clientPath, 'utf-8');

const operationIds = Object.values(spec.paths)
  .flatMap((pathItem) => Object.values(pathItem))
  .map((op) => op.operationId);

describe('generated client is in sync with openapi.json', () => {
  test('spec has operations', () => {
    expect(operationIds.length).toBeGreaterThan(0);
  });

  test('every operationId has a descriptor and a method in the generated client', () => {
    const missing = operationIds.filter((id) => !clientSource.includes(`${id}: {`) || !clientSource.includes(`${id}(`));
    expect(missing).toEqual([]);
  });

  test('operationIds are unique', () => {
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });
});
