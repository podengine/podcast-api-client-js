/**
 * Stage 2 of codegen (runs standalone from the committed openapi.json).
 *
 * 1. Generates `src/generated/schema.ts` from `openapi.json` via openapi-typescript, mapping
 *    `format: date-time` fields to `Date` (the runtime hydrates ISO strings to match).
 * 2. Generates `src/generated/client.ts` — an ergonomic, resource-grouped SDK whose methods
 *    are fully typed against the `operations` interface in schema.ts.
 *
 * Run: bun run scripts/generate-client.ts   (or: pnpm gen:client)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import openapiTS, { astToString } from 'openapi-typescript';
import ts from 'typescript';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');
const SPEC_PATH = join(ROOT, 'openapi.json');
const GENERATED_DIR = join(ROOT, 'src', 'generated');

interface SchemaObject {
  type?: string | string[];
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

interface ParameterObject {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
}

interface OperationObject {
  operationId: string;
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: ParameterObject[];
  requestBody?: { required?: boolean; content: Record<string, { schema: SchemaObject }> };
  responses: Record<string, { content?: Record<string, { schema: SchemaObject }> }>;
}

interface OpenApiSpec {
  paths: Record<string, Record<string, OperationObject>>;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const pascalCase = (input: string): string =>
  input
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

const camelCase = (input: string): string => {
  const pascal = pascalCase(input);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};

interface NormalizedOperation {
  operationId: string;
  tag: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  pathParams: string[];
  queryParams: string[];
  bodyMode: 'none' | 'merge' | 'field';
  binary: boolean;
  /** Whether the JSON success response is wrapped in a `{ status, data }` envelope. */
  hasDataEnvelope: boolean;
  paramsRequired: boolean;
  summary: string | undefined;
  description: string | undefined;
}

const normalizeOperations = (spec: OpenApiSpec): NormalizedOperation[] => {
  const ops: NormalizedOperation[] = [];
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op) continue;

      const params = op.parameters ?? [];
      const pathParams = params.filter((p) => p.in === 'path').map((p) => p.name);
      const queryParams = params.filter((p) => p.in === 'query');
      const queryRequired = queryParams.filter((p) => p.required).map((p) => p.name);

      const body = op.requestBody;
      const bodySchema = body?.content?.['application/json']?.schema;
      const hasBody = Boolean(bodySchema);
      // Object bodies merge their keys into the flat params object; non-object bodies
      // (arrays, primitives) are passed through a dedicated `body` field.
      const isObjectBody =
        hasBody && (bodySchema?.type === 'object' || (!bodySchema?.type && !!bodySchema?.properties));
      const bodyMode: NormalizedOperation['bodyMode'] = !hasBody ? 'none' : isObjectBody ? 'merge' : 'field';
      const bodyRequired = (isObjectBody && bodySchema?.required) || [];

      const success = op.responses['200'] ?? op.responses['201'];
      const binary = Boolean(success?.content?.['application/octet-stream']);
      const jsonResponseSchema = success?.content?.['application/json']?.schema;
      const hasDataEnvelope = Boolean(jsonResponseSchema?.properties && 'data' in jsonResponseSchema.properties);

      // A `field`-mode body is required whenever the request body itself is required.
      const fieldBodyRequired = bodyMode === 'field' && (body?.required ?? true);
      const paramsRequired =
        pathParams.length > 0 || queryRequired.length > 0 || bodyRequired.length > 0 || fieldBodyRequired;

      ops.push({
        operationId: op.operationId,
        tag: op.tags?.[0] ?? 'default',
        method: method.toUpperCase() as NormalizedOperation['method'],
        path,
        pathParams,
        queryParams: queryParams.map((p) => p.name),
        bodyMode,
        binary,
        hasDataEnvelope,
        paramsRequired,
        summary: op.summary,
        description: op.description,
      });
    }
  }
  return ops.sort((a, b) => a.tag.localeCompare(b.tag) || a.operationId.localeCompare(b.operationId));
};

const paramsTypeExpr = (op: NormalizedOperation): string | null => {
  const parts: string[] = [];
  if (op.pathParams.length > 0) parts.push(`NonNullable<operations['${op.operationId}']['parameters']['path']>`);
  if (op.queryParams.length > 0) parts.push(`NonNullable<operations['${op.operationId}']['parameters']['query']>`);
  const bodyExpr = `NonNullable<operations['${op.operationId}']['requestBody']>['content']['application/json']`;
  if (op.bodyMode === 'merge') parts.push(bodyExpr);
  // Non-object bodies (arrays/primitives) can't merge into the flat params object, so they
  // are supplied via a `body` field.
  else if (op.bodyMode === 'field') parts.push(`{ body: ${bodyExpr} }`);
  if (parts.length === 0) return null;
  return parts.join(' & ');
};

const responseTypeExpr = (op: NormalizedOperation): string => {
  if (op.binary) return 'Blob';
  const envelope = `operations['${op.operationId}']['responses']['200']['content']['application/json']`;
  return op.hasDataEnvelope ? `${envelope}['data']` : envelope;
};

const jsDoc = (op: NormalizedOperation, indent: string): string => {
  const lines = [op.summary, op.description].filter((l): l is string => Boolean(l && l.trim()));
  if (lines.length === 0) lines.push(`${op.method} ${op.path}`);
  const body = lines.map((l) => `${indent} * ${l.replace(/\*\//g, '* /')}`).join('\n');
  return `${indent}/**\n${body}\n${indent} */`;
};

const generateClientSource = (ops: NormalizedOperation[]): string => {
  const byTag = new Map<string, NormalizedOperation[]>();
  for (const op of ops) {
    const list = byTag.get(op.tag) ?? [];
    list.push(op);
    byTag.set(op.tag, list);
  }
  const tags = [...byTag.keys()].sort();

  const header = `/**
 * AUTO-GENERATED by scripts/generate-client.ts — DO NOT EDIT BY HAND.
 * Regenerate with: pnpm gen:client (or pnpm gen:all to refresh the spec first).
 */
/* eslint-disable */
import { PodEngineCore, type ClientOptions, type RequestOptions, type EndpointDescriptor } from '../core/client-core';
import type { operations } from './schema';
`;

  // Exported param/response type aliases per operation.
  const typeAliases: string[] = [];
  for (const op of ops) {
    const pascal = pascalCase(op.operationId);
    const paramsExpr = paramsTypeExpr(op);
    if (paramsExpr) typeAliases.push(`export type ${pascal}Params = ${paramsExpr};`);
    typeAliases.push(`export type ${pascal}Response = ${responseTypeExpr(op)};`);
  }

  // Descriptor table (static per-endpoint metadata used by the transport core).
  const descriptorEntries = ops.map((op) => {
    const fields = [
      `method: '${op.method}'`,
      `path: '${op.path}'`,
      `pathParams: [${op.pathParams.map((p) => `'${p}'`).join(', ')}]`,
      `queryParams: [${op.queryParams.map((p) => `'${p}'`).join(', ')}]`,
      `body: '${op.bodyMode}'`,
      `binary: ${op.binary}`,
    ];
    return `  ${op.operationId}: { ${fields.join(', ')} },`;
  });
  const descriptorTable = `const descriptors = {\n${descriptorEntries.join('\n')}\n} satisfies Record<string, EndpointDescriptor>;`;

  // Resource classes.
  const resourceClasses: string[] = [];
  const resourceFields: string[] = [];
  const resourceInits: string[] = [];

  for (const tag of tags) {
    const className = `${pascalCase(tag)}Resource`;
    const propName = camelCase(tag);
    resourceFields.push(`  /** ${tag} endpoints */\n  readonly ${propName}: ${className};`);
    resourceInits.push(`    this.${propName} = new ${className}(core);`);

    const methods = byTag.get(tag)!.map((op) => {
      const pascal = pascalCase(op.operationId);
      const paramsExpr = paramsTypeExpr(op);
      const ret = `Promise<${pascal}Response>`;
      const doc = jsDoc(op, '  ');
      if (!paramsExpr) {
        return `${doc}\n  ${op.operationId}(options?: RequestOptions): ${ret} {\n    return this.core.request(descriptors.${op.operationId}, undefined, options);\n  }`;
      }
      const paramsArg = op.paramsRequired ? `params: ${pascal}Params` : `params?: ${pascal}Params`;
      return `${doc}\n  ${op.operationId}(${paramsArg}, options?: RequestOptions): ${ret} {\n    return this.core.request(descriptors.${op.operationId}, params as Record<string, unknown>, options);\n  }`;
    });

    resourceClasses.push(
      `class ${className} {\n  constructor(private readonly core: PodEngineCore) {}\n\n${methods.join('\n\n')}\n}`
    );
  }

  const mainClass = `/**
 * Pod Engine API client.
 *
 * @example
 * const pe = new PodEngine({ apiKey: process.env.PODENGINE_API_KEY! });
 * const chart = await pe.charts.getLatestChart({ chartType: 'apple', country: 'us', category: 'top podcasts' });
 */
export class PodEngine {
${resourceFields.join('\n')}

  constructor(options: ClientOptions) {
    const core = new PodEngineCore(options);
${resourceInits.join('\n')}
  }
}`;

  return [header, typeAliases.join('\n'), descriptorTable, resourceClasses.join('\n\n'), mainClass, ''].join('\n\n');
};

const main = async () => {
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf-8')) as OpenApiSpec;

  // 1. Types via openapi-typescript, with date-time -> Date.
  const DateRef = ts.factory.createTypeReferenceNode('Date');
  const NullKeyword = ts.factory.createLiteralTypeNode(ts.factory.createNull());
  const ast = await openapiTS(spec as never, {
    transform(schemaObject: { format?: string; nullable?: boolean }) {
      if (schemaObject.format === 'date-time') {
        return schemaObject.nullable ? ts.factory.createUnionTypeNode([DateRef, NullKeyword]) : DateRef;
      }
      return undefined;
    },
  });
  const schemaSource = `/**
 * AUTO-GENERATED by openapi-typescript via scripts/generate-client.ts — DO NOT EDIT BY HAND.
 */
/* eslint-disable */
${astToString(ast)}`;

  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(join(GENERATED_DIR, 'schema.ts'), schemaSource, 'utf-8');

  // 2. Ergonomic client.
  const ops = normalizeOperations(spec);
  const seen = new Set<string>();
  for (const op of ops) {
    if (seen.has(op.operationId)) throw new Error(`Duplicate operationId in spec: ${op.operationId}`);
    seen.add(op.operationId);
  }
  writeFileSync(join(GENERATED_DIR, 'client.ts'), generateClientSource(ops), 'utf-8');

  const tagCount = new Set(ops.map((o) => o.tag)).size;
  console.log(`Generated src/generated/{schema,client}.ts — ${ops.length} operations across ${tagCount} resources`);
};

void main();
