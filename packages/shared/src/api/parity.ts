/**
 * API parity: everything new in the product reaches the API, or says why not
 * (docs/api-v1.md §10, CLAUDE.md «Паритет API»).
 *
 * Pure: the migrations, the coverage data, the registry, the built spec and the
 * dictionaries come in as values, and the answer is the list of what disagrees.
 * The parity test feeds it the repository; it also feeds it a migration made up
 * for the test, to prove that a new function nobody classified fails it.
 */

import type { ApiRegistry } from './registry';

type Json = Record<string, unknown>;

export type CoverageStatus = 'exposed' | 'planned' | 'internal';

export interface CoverageEntry {
  readonly status: CoverageStatus;
  readonly scope?: string;
  readonly operations?: readonly string[];
  readonly reason: string;
  readonly defined_in?: string;
}

export interface Coverage {
  readonly version: number;
  readonly functions: Readonly<Record<string, CoverageEntry>>;
  readonly tables: Readonly<Record<string, CoverageEntry>>;
}

export interface Migration {
  readonly name: string;
  readonly sql: string;
}

export interface SchemaObjects {
  readonly functions: ReadonlySet<string>;
  /** Tables and views alike: both are what a client could read. */
  readonly tables: ReadonlySet<string>;
}

/** Comments out, so that prose about a function does not create it. Dollar-quoted bodies stay. */
function withoutComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

const STATEMENTS: readonly { readonly kind: 'functions' | 'tables'; readonly add: boolean; readonly re: RegExp }[] = [
  { kind: 'functions', add: true, re: /\bcreate\s+(?:or\s+replace\s+)?function\s+(?:(\w+)\.)?"?(\w+)"?\s*\(/gi },
  { kind: 'functions', add: false, re: /\bdrop\s+function\s+(?:if\s+exists\s+)?(?:(\w+)\.)?"?(\w+)"?/gi },
  {
    kind: 'tables',
    add: true,
    re: /\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?"?(\w+)"?/gi,
  },
  {
    kind: 'tables',
    add: true,
    re: /\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?"?(\w+)"?/gi,
  },
  { kind: 'tables', add: false, re: /\bdrop\s+(?:materialized\s+)?(?:table|view)\s+(?:if\s+exists\s+)?(?:(\w+)\.)?"?(\w+)"?/gi },
];

/**
 * The functions, tables and views of schema `public` after every migration,
 * in order. A name without a schema is public's, as the migrations' search
 * path makes it; temporary tables of a migration's own work are not.
 */
export function schemaObjects(migrations: readonly Migration[]): SchemaObjects {
  const functions = new Set<string>();
  const tables = new Set<string>();
  for (const migration of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = withoutComments(migration.sql);
    const events: { index: number; kind: 'functions' | 'tables'; add: boolean; name: string }[] = [];
    for (const statement of STATEMENTS) {
      for (const match of sql.matchAll(statement.re)) {
        const schema = (match[1] ?? 'public').toLowerCase();
        const before = sql.slice(Math.max(0, (match.index ?? 0) - 20), match.index).toLowerCase();
        if (schema !== 'public' || /\btemp(orary)?\s+$/.test(before)) {
          continue;
        }
        events.push({ index: match.index ?? 0, kind: statement.kind, add: statement.add, name: match[2].toLowerCase() });
      }
    }
    for (const event of events.sort((a, b) => a.index - b.index)) {
      const set = event.kind === 'functions' ? functions : tables;
      if (event.add) {
        set.add(event.name);
      } else {
        set.delete(event.name);
      }
    }
  }
  return { functions, tables };
}

export interface ScopeRow {
  readonly id: string;
  readonly group: string;
  readonly action: string;
  readonly sensitivity: string;
  readonly status: string;
  readonly operator: boolean;
}

const SCOPE_ROW = /\('([a-z_]+:[a-z_]+)',\s*'([a-z_]+)',\s*'(read|write)',\s*'(normal|sensitive)',\s*'(exposed|planned|forbidden)',\s*(true|false)\)/g;

/** The database's copy of the registry: the api-scopes blocks of the migrations, later rows winning. */
export function migrationScopes(migrations: readonly Migration[]): Map<string, ScopeRow> {
  const rows = new Map<string, ScopeRow>();
  for (const migration of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const block of migration.sql.matchAll(/-- api-scopes:begin([\s\S]*?)-- api-scopes:end/g)) {
      for (const row of block[1].matchAll(SCOPE_ROW)) {
        rows.set(row[1], {
          id: row[1],
          group: row[2],
          action: row[3],
          sensitivity: row[4],
          status: row[5],
          operator: row[6] === 'true',
        });
      }
    }
  }
  return rows;
}

function operationsOf(spec: Json): Json[] {
  const result: Json[] = [];
  for (const item of Object.values((spec.paths ?? {}) as Record<string, Json>)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (item[method] !== undefined) {
        result.push(item[method] as Json);
      }
    }
  }
  return result;
}

function fieldScopes(spec: Json): Set<string> {
  const scopes = new Set<string>();
  const schemas = ((spec.components as Json | undefined)?.schemas ?? {}) as Record<string, Json>;
  for (const schema of Object.values(schemas)) {
    for (const property of Object.values((schema.properties ?? {}) as Record<string, Json>)) {
      if (typeof property['x-woom-scope'] === 'string') {
        scopes.add(property['x-woom-scope'] as string);
      }
    }
  }
  return scopes;
}

function lookup(dictionary: Json, path: string): unknown {
  let node: unknown = dictionary;
  for (const part of path.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Json)[part] : undefined;
  }
  return node;
}

/** The operation the spec allows without a scope: a key asking about itself. */
export const SCOPELESS_OPERATIONS: ReadonlySet<string> = new Set(['getMe']);

export interface ParityInput {
  readonly migrations: readonly Migration[];
  readonly coverage: Coverage;
  readonly registry: ApiRegistry;
  /** The built spec (openapi.v1.json). */
  readonly spec: Json;
  /** The dictionaries by language: en, cs, ru. */
  readonly locales: Readonly<Record<string, Json>>;
}

/** Everything that disagrees, one sentence each; empty when API and product agree. */
export function parityProblems({ migrations, coverage, registry, spec, locales }: ParityInput): string[] {
  const problems: string[] = [];
  const objects = schemaObjects(migrations);
  const registryIds = new Map(registry.scopes.map((scope) => [scope.id, scope]));
  const forbiddenIds = new Set(registry.forbidden.map((entry) => entry.id));
  const operations = operationsOf(spec);
  const operationIds = new Set(operations.map((op) => String(op.operationId)));

  // 1. Every public function and table of the migrations is classified, and nothing else is.
  for (const kind of ['functions', 'tables'] as const) {
    const listed = coverage[kind];
    for (const name of [...objects[kind]].sort()) {
      if (listed[name] === undefined) {
        problems.push(
          `${kind === 'functions' ? 'function' : 'table'} public.${name} is in the migrations but not in coverage.json: ` +
            'add it as exposed (scope, operations), planned (scope) or internal (reason)',
        );
      }
    }
    for (const name of Object.keys(listed).sort()) {
      if (!objects[kind].has(name)) {
        problems.push(`coverage.json lists ${kind === 'functions' ? 'function' : 'table'} ${name}, which no migration leaves in public`);
      }
    }
    // 2. Each entry is well formed.
    for (const [name, entry] of Object.entries(listed)) {
      if (!['exposed', 'planned', 'internal'].includes(entry.status)) {
        problems.push(`${name}: unknown status ${String(entry.status)}`);
        continue;
      }
      if (typeof entry.reason !== 'string' || entry.reason.trim().length < 10) {
        problems.push(`${name}: needs a reason of a few words`);
      }
      if (entry.status === 'internal') {
        continue;
      }
      const scope = entry.scope === undefined ? undefined : registryIds.get(entry.scope);
      const isScopeless = entry.status === 'exposed' && entry.scope === undefined &&
        (entry.operations ?? []).every((op) => SCOPELESS_OPERATIONS.has(op)) && (entry.operations ?? []).length > 0;
      if (!isScopeless) {
        if (entry.scope === undefined || scope === undefined) {
          problems.push(`${name}: ${entry.status} needs a scope of the registry (got ${String(entry.scope)})`);
        } else if (entry.status === 'exposed' && scope.status !== 'exposed') {
          problems.push(`${name}: exposed under ${scope.id}, which the registry has as ${scope.status}`);
        }
      }
      if (entry.scope !== undefined && forbiddenIds.has(entry.scope)) {
        problems.push(`${name}: ${entry.scope} is on the forbidden list`);
      }
      for (const op of entry.operations ?? []) {
        if (!operationIds.has(op)) {
          problems.push(`${name}: operation ${op} is not in the spec`);
        }
      }
      if (entry.status === 'exposed' && (entry.operations ?? []).length === 0) {
        problems.push(`${name}: exposed needs the operations that use it`);
      }
    }
  }

  // 3. Every operation names its scope, from the registry; every exposed scope is used.
  const usedScopes = fieldScopes(spec);
  for (const op of operations) {
    const id = String(op.operationId);
    if (!('x-woom-scope' in op)) {
      problems.push(`operation ${id} has no x-woom-scope`);
      continue;
    }
    const scope = op['x-woom-scope'];
    if (scope === null) {
      if (!SCOPELESS_OPERATIONS.has(id)) {
        problems.push(`operation ${id} has no scope; only ${[...SCOPELESS_OPERATIONS].join(', ')} may`);
      }
      continue;
    }
    const entry = registryIds.get(String(scope));
    if (entry === undefined) {
      problems.push(`operation ${id} needs ${String(scope)}, which the registry does not have`);
    } else if (entry.status !== 'exposed') {
      problems.push(`operation ${id} needs ${entry.id}, which the registry has as ${entry.status}`);
    }
    usedScopes.add(String(scope));
  }
  const description = String(((spec.info ?? {}) as Json).description ?? '');
  for (const scope of registry.scopes.filter((s) => s.status === 'exposed')) {
    if (!usedScopes.has(scope.id)) {
      problems.push(`scope ${scope.id} is exposed but no operation or field of the spec uses it`);
    }
    if (!description.includes(`\`${scope.id}\``)) {
      problems.push(`scope ${scope.id} is missing from the documentation's table of scopes (npm run api:docs)`);
    }
    const [group, action] = scope.id.split(':');
    for (const [language, dictionary] of Object.entries(locales)) {
      for (const part of ['label', 'hint']) {
        const key = `panel.settings.api.scopes.${group}.${action}.${part}`;
        if (typeof lookup(dictionary, key) !== 'string') {
          problems.push(`${language}: ${key} is missing`);
        }
      }
    }
  }
  for (const entry of registry.forbidden) {
    if (registryIds.has(entry.id)) {
      problems.push(`${entry.id} is both a scope and on the forbidden list`);
    }
  }

  // 4. The database's copy of the registry is the registry.
  const inDatabase = migrationScopes(migrations);
  const wanted = new Map<string, ScopeRow>([
    ...registry.scopes.map((s) => [s.id, { id: s.id, group: s.group, action: s.action, sensitivity: s.sensitivity, status: s.status, operator: s.operator }] as const),
    ...registry.forbidden.map((f) => [f.id, inDatabase.get(f.id) ?? { id: f.id, group: 'forbidden', action: '', sensitivity: 'sensitive', status: 'forbidden', operator: false }] as const),
  ]);
  for (const [id, row] of wanted) {
    const actual = inDatabase.get(id);
    if (actual === undefined) {
      problems.push(`scope ${id} is in the registry but no migration's api-scopes block has it`);
    } else if (row.status === 'forbidden' ? actual.status !== 'forbidden' : JSON.stringify(actual) !== JSON.stringify(row)) {
      problems.push(`scope ${id}: the migrations say ${JSON.stringify(actual)}, the registry ${JSON.stringify(row)}`);
    }
  }
  for (const id of inDatabase.keys()) {
    if (!wanted.has(id)) {
      problems.push(`scope ${id} is in a migration's api-scopes block but not in the registry`);
    }
  }
  return problems;
}
