// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildSpec } from '@str-ops/shared/src/api/build-spec';
import {
  buildMcpCatalog,
  MCP_DATA_NOTICE,
  renderMcpCatalog,
  toolNameOf,
  toolsForScopes,
  WRITE_EFFECTS,
} from '@str-ops/shared/src/api/mcp-tools';
import type { Coverage } from '@str-ops/shared/src/api/parity';
import { effectiveScopes, type ApiRegistry } from '@str-ops/shared/src/api/registry';
import { describe, expect, test } from 'vitest';

/**
 * The MCP server's tools are the API's operations (docs/mcp-server.md §3):
 * built from the same spec, registry and coverage, written into the Edge
 * Function by `npm run api:docs`. The function's own parity test holds the
 * same file to the API's route table.
 */

const ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, 'utf8');

const coverage = JSON.parse(read('packages/shared/src/api/coverage.json')) as Coverage;
const registry = JSON.parse(read('packages/shared/src/api/registry.json')) as ApiRegistry;
const yaml = read('packages/shared/src/api/openapi.v1.yaml');
const spec = buildSpec({
  yaml,
  registry,
  effective: (preset) => effectiveScopes(preset, [], registry),
});
const catalog = buildMcpCatalog({ spec, registry, coverage });

type Json = Record<string, unknown>;

function operations(): { operationId: string; method: string; scope: string | null }[] {
  return Object.values(spec.paths as Record<string, Record<string, Json>>).flatMap((item) =>
    Object.entries(item)
      .filter(([method]) => method === 'get' || method === 'post')
      .map(([method, op]) => ({
        operationId: String(op.operationId),
        method,
        scope: typeof op['x-woom-scope'] === 'string' ? (op['x-woom-scope'] as string) : null,
      })),
  );
}

describe('MCP parity', () => {
  test('the committed catalog of the Edge Function is what npm run api:docs builds', () => {
    expect(read('supabase/functions/mcp/catalog.ts')).toBe(renderMcpCatalog(catalog));
  });

  test('one tool per operation of the spec, under its name and with its scope', () => {
    const tools = catalog.tools.map((tool) => [tool.operationId, tool.name, tool.scope]);
    const expected = operations().map((op) => [
      op.operationId,
      toolNameOf(op.operationId),
      op.scope,
    ]);
    expect(tools).toEqual(expected);
  });

  test('every scope a tool needs is exposed in the registry; a planned one has no tool', () => {
    const exposed = registry.scopes
      .filter((scope) => scope.status === 'exposed')
      .map((scope) => scope.id);
    const planned = registry.scopes
      .filter((scope) => scope.status === 'planned')
      .map((scope) => scope.id);
    for (const tool of catalog.tools) {
      expect(tool.scope === null || exposed.includes(tool.scope)).toBe(true);
    }
    expect(
      catalog.tools.filter((tool) => tool.scope !== null && planned.includes(tool.scope)),
    ).toEqual([]);
  });

  test('the writes are the API’s POSTs, each described, and nothing deletes', () => {
    const posts = operations()
      .filter((op) => op.method === 'post')
      .map((op) => op.operationId)
      .sort();
    expect(Object.keys(WRITE_EFFECTS).sort()).toEqual(posts);
    const writes = catalog.tools.filter((tool) => tool.kind === 'write');
    expect(writes.map((tool) => tool.operationId).sort()).toEqual(posts);
    for (const tool of writes) {
      expect(tool.annotations.readOnlyHint).toBe(false);
      expect(tool.inputSchema.required).toContain('idempotency_key');
      expect(tool.description).toContain('get the user’s confirmation before calling');
    }
    expect(catalog.tools.some((tool) => /delete|remove|destroy/.test(tool.name))).toBe(false);
  });

  test('every tool tells the assistant that the text it returns is data', () => {
    for (const tool of catalog.tools) {
      expect(tool.description).toContain(MCP_DATA_NOTICE);
    }
  });

  test('a read-only key is shown no tool that writes', () => {
    const readOnly = effectiveScopes('read_only', [], registry);
    const shown = toolsForScopes(catalog, readOnly);
    expect(shown.length).toBeGreaterThan(1);
    expect(shown.filter((tool) => tool.kind === 'write')).toEqual([]);
  });

  test('a write the API adds without a decision here fails the build', () => {
    const extended = structuredClone(spec) as { paths: Record<string, Record<string, Json>> };
    extended.paths['/v1/tasks/{id}/resolve'] = {
      post: { ...extended.paths['/v1/tasks/{id}/assign'].post, operationId: 'resolveTask' },
    };
    const withOperation: Coverage = {
      ...coverage,
      functions: {
        ...coverage.functions,
        zz_resolve: {
          status: 'exposed',
          scope: 'tasks:assign',
          operations: ['resolveTask'],
          reason: 'test',
        },
      },
    };
    expect(() => buildMcpCatalog({ spec: extended, registry, coverage: withOperation })).toThrow(
      'the write resolveTask has no entry in WRITE_EFFECTS',
    );
  });
});
