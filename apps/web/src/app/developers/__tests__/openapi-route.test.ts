// @vitest-environment node
import openapi from '@str-ops/shared/src/api/openapi.v1.json';
import { describe, expect, test } from 'vitest';

import { GET } from '../openapi.json/route';
import { apiServerUrl, publicSpec } from '../spec';

interface ServedSpec {
  servers: { url: string; description?: string }[];
  paths: Record<string, unknown>;
  info: { title: string; version: string };
}

async function servedSpec(): Promise<ServedSpec> {
  return (await GET().json()) as ServedSpec;
}

describe('the OpenAPI file', () => {
  test('is JSON, cached for five minutes', () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
  });

  test('names this project’s API as its one server', async () => {
    const spec = await servedSpec();

    expect(spec.servers).toHaveLength(1);
    expect(spec.servers[0].url).toMatch(/\/functions\/v1\/api$/);
    expect(spec.servers[0].url).toBe('https://project.supabase.co/functions/v1/api');
  });

  test('is the committed spec otherwise', async () => {
    const spec = await servedSpec();

    expect(Object.keys(spec.paths)).toContain('/v1/cleanings');
    expect(spec).toEqual({
      ...JSON.parse(JSON.stringify(openapi)),
      servers: [{ url: 'https://project.supabase.co/functions/v1/api', description: 'woom API' }],
    });
  });
});

describe('the server address', () => {
  test.each([
    ['https://abc.supabase.co', 'https://abc.supabase.co/functions/v1/api'],
    ['https://abc.supabase.co/', 'https://abc.supabase.co/functions/v1/api'],
    ['http://127.0.0.1:54321//', 'http://127.0.0.1:54321/functions/v1/api'],
  ])('%s gives %s', (supabaseUrl, expected) => {
    expect(apiServerUrl(supabaseUrl)).toBe(expected);
  });

  test('a new spec object every call, the import untouched', () => {
    const committedServers = structuredClone(openapi.servers);

    const first = publicSpec('https://abc.supabase.co');
    const second = publicSpec('https://abc.supabase.co');

    expect(first).not.toBe(second);
    expect(first.servers).not.toBe(openapi.servers);
    expect(openapi.servers).toEqual(committedServers);
  });
});
