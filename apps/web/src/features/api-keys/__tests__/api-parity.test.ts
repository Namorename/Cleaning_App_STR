// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildSpec, renderSpec } from '@str-ops/shared/src/api/build-spec';
import { renderCoverageDoc } from '@str-ops/shared/src/api/coverage-doc';
import { parityProblems, schemaObjects, type Coverage, type Migration } from '@str-ops/shared/src/api/parity';
import { effectiveScopes, type ApiRegistry } from '@str-ops/shared/src/api/registry';
import { describe, expect, test } from 'vitest';

/**
 * API parity in the ordinary run (docs/api-v1.md §10): a new function or table
 * of the product, a new operation or a new scope that the API, its registry,
 * its documentation or its translations do not account for fails here.
 */

const ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, 'utf8');

const migrations: Migration[] = readdirSync(`${ROOT}supabase/migrations`)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => ({ name, sql: read(`supabase/migrations/${name}`) }));
const coverage = JSON.parse(read('packages/shared/src/api/coverage.json')) as Coverage;
const registry = JSON.parse(read('packages/shared/src/api/registry.json')) as ApiRegistry;
const yaml = read('packages/shared/src/api/openapi.v1.yaml');
const committedSpec = read('packages/shared/src/api/openapi.v1.json');
const locales = Object.fromEntries(
  ['en', 'cs', 'ru'].map((language) => [
    language,
    JSON.parse(read(`packages/shared/src/i18n/locales/${language}.json`)) as Record<string, unknown>,
  ]),
);

const built = buildSpec({ yaml, registry, effective: (preset) => effectiveScopes(preset, [], registry) });
const real = { migrations, coverage, registry, spec: built, locales };

describe('API parity', () => {
  test('the API, its registry, its spec, its translations and the schema agree', () => {
    expect(parityProblems(real)).toEqual([]);
  });

  test('the committed spec is what npm run api:docs builds', () => {
    expect(committedSpec).toBe(renderSpec(built));
  });

  test('docs/api-coverage.md is what npm run api:docs writes', () => {
    expect(read('docs/api-coverage.md')).toBe(renderCoverageDoc(coverage));
  });

  test('a new function nobody classified fails the run', () => {
    const added: Migration = {
      name: '29991231000000_new_feature.sql',
      sql: 'create or replace function public.zz_new_feature(p_id uuid) returns void language sql as $$ select 1 $$;',
    };
    expect(parityProblems({ ...real, migrations: [...migrations, added] })).toEqual([
      expect.stringContaining('function public.zz_new_feature is in the migrations but not in coverage.json'),
    ]);
  });

  test('a new table nobody classified fails the run, a dropped one leaves a stale entry', () => {
    const added: Migration = {
      name: '29991231000001_new_table.sql',
      sql: 'create table public.zz_new_things (id uuid primary key);\ndrop function public.api_ts(timestamptz);',
    };
    const problems = parityProblems({ ...real, migrations: [...migrations, added] });
    expect(problems).toContainEqual(expect.stringContaining('table public.zz_new_things is in the migrations'));
    expect(problems).toContainEqual(expect.stringContaining('coverage.json lists function api_ts'));
  });

  test('an operation without a scope, or with one the registry lacks, fails the run', () => {
    const spec = structuredClone(built) as { paths: Record<string, Record<string, Record<string, unknown>>> };
    spec.paths['/v1/settings'].get['x-woom-scope'] = null;
    spec.paths['/v1/staff'].get['x-woom-scope'] = 'staff:everything';
    const problems = parityProblems({ ...real, spec });
    expect(problems).toContainEqual(expect.stringContaining('operation getSettings has no scope'));
    expect(problems).toContainEqual(expect.stringContaining('operation listStaff needs staff:everything'));
  });

  test('an exposed scope with no operation, no docs row or no translation fails the run', () => {
    const withNew: ApiRegistry = {
      ...registry,
      scopes: [
        ...registry.scopes,
        { id: 'zz:read', group: 'settings', action: 'read', sensitivity: 'normal', status: 'exposed', operator: false },
      ],
    };
    const problems = parityProblems({ ...real, registry: withNew });
    expect(problems).toContainEqual('scope zz:read is exposed but no operation or field of the spec uses it');
    expect(problems).toContainEqual(expect.stringContaining('scope zz:read is missing from the documentation'));
    expect(problems).toContainEqual('en: panel.settings.api.scopes.zz.read.label is missing');
    expect(problems).toContainEqual(expect.stringContaining('scope zz:read is in the registry but no migration'));
  });

  test('a migration that changes a scope without the registry fails the run', () => {
    const changed: Migration = {
      name: '29991231000002_scope.sql',
      sql: "-- api-scopes:begin\ninsert into public.api_scopes values\n  ('staff:read', 'staff', 'read', 'sensitive', 'exposed', false)\non conflict do nothing;\n-- api-scopes:end\n",
    };
    expect(parityProblems({ ...real, migrations: [...migrations, changed] })).toContainEqual(
      expect.stringContaining('scope staff:read: the migrations say'),
    );
  });

  test('comments do not create functions; temporary work tables are not the schema', () => {
    const objects = schemaObjects([
      { name: 'a.sql', sql: '-- create function public.nope()\ncreate temp table _work (id int);\n/* create table public.nor_this (x int) */' },
    ]);
    expect([...objects.functions, ...objects.tables]).toEqual([]);
  });

  test('a line comment holding /* hides nothing, nor does a string holding --', () => {
    const objects = schemaObjects([
      {
        name: 'a.sql',
        sql:
          "-- see docs/*.md\ncreate function public.zz_hidden() returns void language sql as $$ select 1 $$;\n/** doc */\n" +
          "select '-- not a comment'; create function public.zz_after() returns void language sql as $$ select 1 $$;\n" +
          'create table "public"."zz_quoted" (x int);',
      },
    ]);
    expect([...objects.functions].sort()).toEqual(['zz_after', 'zz_hidden']);
    expect([...objects.tables]).toEqual(['zz_quoted']);
  });

  test('overloads are tracked by signature; renames and moves out of public count', () => {
    const objects = schemaObjects([
      {
        name: 'a.sql',
        sql:
          'create function public.zz_f(p text) returns void language sql as $$ select 1 $$;\n' +
          'create function public.zz_f(p int) returns void language sql as $$ select 1 $$;\n' +
          'drop function public.zz_f(integer);\n' +
          'create function public.zz_g(p_at timestamptz default now()) returns void language sql as $$ select 1 $$;\n' +
          'drop function if exists public.zz_g(timestamp with time zone);\n' +
          'create table public.zz_a (x int);\nalter table public.zz_a rename to zz_b;\n' +
          'create table public.zz_c (x int);\nalter table public.zz_c set schema raw;\n' +
          'create function public.zz_h() returns void language sql as $$ select 1 $$;\n' +
          'alter function public.zz_h() rename to zz_i;',
      },
    ]);
    expect([...objects.functions].sort()).toEqual(['zz_f', 'zz_i']);
    expect([...objects.tables].sort()).toEqual(['zz_b']);
  });
});

describe('preset rule of the panel = the database rule (supabase/tests/api_v1.sql §2)', () => {
  const rule = (preset: Parameters<typeof effectiveScopes>[0], picked: string[] = []) =>
    effectiveScopes(preset, picked, registry).join(',');

  test('read only: every ordinary read scope', () => {
    expect(rule('read_only')).toBe(
      'bookings:read,cleanings:read,media:read,properties:read,settings:read,staff:read,tasks:read',
    );
  });

  test('operator: reading, and creating and assigning tasks and cleanings', () => {
    expect(rule('operator')).toBe(
      'bookings:read,cleanings:assign,cleanings:read,media:read,properties:read,settings:read,staff:read,tasks:assign,tasks:create,tasks:read',
    );
  });

  test('full: every exposed scope, the sensitive ones included; never a forbidden or planned one', () => {
    const exposed = registry.scopes.filter((s) => s.status === 'exposed').map((s) => s.id).sort();
    expect(rule('full')).toBe(exposed.join(','));
    expect(rule('full', ['api_keys:manage', 'webhooks:manage'])).toBe(exposed.join(','));
  });

  test('a sensitive scope ticked by hand joins read only; custom is exactly the ticks', () => {
    expect(rule('read_only', ['staff:read_names'])).toContain('staff:read_names');
    expect(rule('custom', ['cleanings:read'])).toBe('cleanings:read');
  });

  test('a scope added later joins the presets by their rules', () => {
    const later: ApiRegistry = {
      ...registry,
      scopes: [
        ...registry.scopes,
        { id: 'zz_test:read', group: 'zz', action: 'read', sensitivity: 'normal', status: 'exposed', operator: false },
        { id: 'zz_test:read_secret', group: 'zz', action: 'read', sensitivity: 'sensitive', status: 'exposed', operator: false },
        { id: 'zz_test:write', group: 'zz', action: 'write', sensitivity: 'normal', status: 'exposed', operator: true },
      ],
    };
    const of = (preset: Parameters<typeof effectiveScopes>[0]) => effectiveScopes(preset, [], later);
    expect(of('read_only')).toContain('zz_test:read');
    expect(of('read_only')).not.toContain('zz_test:read_secret');
    expect(of('operator')).toContain('zz_test:write');
    expect(of('full')).toEqual(expect.arrayContaining(['zz_test:read', 'zz_test:read_secret', 'zz_test:write']));
  });
});
