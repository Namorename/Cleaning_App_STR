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

/**
 * The SQL with every comment blanked and the inside of every string literal
 * blanked, in one pass, so that neither prose nor data can create or hide a
 * function: a `--` line holding `/*` does not open a block, a string holding
 * `--` does not end the line early, block comments nest as Postgres nests them.
 * Dollar-quoted bodies are scanned as code (their own comments and strings are
 * handled the same way); quoted identifiers are kept. Positions are preserved.
 */
export function scrubSql(sql: string): string {
  const out: string[] = [];
  let i = 0;
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const end = sql.indexOf('\n', i);
      const stop = end < 0 ? sql.length : end;
      out.push(blank(sql.slice(i, stop)));
      i = stop;
    } else if (two === '/*') {
      let depth = 0;
      let j = i;
      while (j < sql.length) {
        if (sql.startsWith('/*', j)) {
          depth += 1;
          j += 2;
        } else if (sql.startsWith('*/', j)) {
          depth -= 1;
          j += 2;
          if (depth === 0) break;
        } else {
          j += 1;
        }
      }
      out.push(blank(sql.slice(i, j)));
      i = j;
    } else if (sql[i] === "'") {
      const escapes = i > 0 && /[eE]/.test(sql[i - 1]) && !/\w/.test(sql[i - 2] ?? ' ');
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === '\\') {
          j += 2;
        } else if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
        } else if (sql[j] === "'") {
          break;
        } else {
          j += 1;
        }
      }
      out.push("'", blank(sql.slice(i + 1, j)), j < sql.length ? "'" : '');
      i = j + 1;
    } else if (sql[i] === '"') {
      const end = sql.indexOf('"', i + 1);
      const stop = end < 0 ? sql.length : end + 1;
      out.push(sql.slice(i, stop));
      i = stop;
    } else {
      out.push(sql[i]);
      i += 1;
    }
  }
  return out.join('');
}

const NAME = String.raw`(?:"?(\w+)"?\s*\.\s*)?"?(\w+)"?`;

/** A type as Postgres prints it in a signature, near enough to compare a create with a drop. */
function normalizeType(raw: string): string {
  const type = raw.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^public\./, '').replace(/"/g, '');
  const aliases: Readonly<Record<string, string>> = {
    int: 'integer', int4: 'integer', int8: 'bigint', int2: 'smallint', bool: 'boolean',
    timestamptz: 'timestamp with time zone', timestamp: 'timestamp without time zone',
    timetz: 'time with time zone', time: 'time without time zone', varchar: 'character varying',
    float8: 'double precision', float4: 'real', decimal: 'numeric',
  };
  const array = type.endsWith('[]') ? '[]' : '';
  const base = array ? type.slice(0, -2).trim() : type;
  return `${aliases[base] ?? base.replace(/\(.*\)$/, '')}${array}`;
}

const TYPE_WORDS = /^(public\.)?(int|int2|int4|int8|integer|bigint|smallint|text|uuid|bool|boolean|date|time|timetz|timestamp|timestamptz|numeric|decimal|jsonb|json|double|real|float4|float8|character|varchar|interval|bytea|regclass|regprocedure|anyelement|record|void|name|oid|cidr|inet)(\[\])?$/i;

/** The argument types of a signature, for telling overloads apart; OUT arguments are not part of it. */
function signatureOf(args: string): string {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of args) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim() !== '') parts.push(current);
  return parts
    .map((part) => part.replace(/\s+(default\b|=)[\s\S]*$/i, '').trim())
    .filter((part) => part !== '' && !/^out\s/i.test(part))
    .map((part) => {
      const tokens = part.replace(/^(in|inout|variadic)\s+/i, '').split(/\s+/);
      const typeTokens = tokens.length > 1 && !TYPE_WORDS.test(tokens[0]) ? tokens.slice(1) : tokens;
      return normalizeType(typeTokens.join(' '));
    })
    .join(',');
}

/** The text between the parenthesis at `open` and its partner. */
function balanced(sql: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, i);
    }
  }
  return null;
}

type Kind = 'functions' | 'tables';

interface SchemaEvent {
  readonly index: number;
  readonly kind: Kind;
  readonly op: 'add' | 'drop' | 'rename' | 'leave';
  readonly name: string;
  /** Functions: the signature; null drops every overload. */
  readonly signature: string | null;
  readonly to?: string;
}

const PATTERNS: readonly { kind: Kind; op: SchemaEvent['op']; re: RegExp; hasArgs: boolean }[] = [
  { kind: 'functions', op: 'add', hasArgs: true, re: new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\s+${NAME}\s*\(`, 'gi') },
  { kind: 'functions', op: 'drop', hasArgs: true, re: new RegExp(String.raw`\bdrop\s+(?:function|procedure)\s+(?:if\s+exists\s+)?${NAME}\s*(\()?`, 'gi') },
  { kind: 'functions', op: 'rename', hasArgs: true, re: new RegExp(String.raw`\balter\s+(?:function|procedure)\s+${NAME}\s*(\()?`, 'gi') },
  { kind: 'tables', op: 'add', hasArgs: false, re: new RegExp(String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${NAME}`, 'gi') },
  { kind: 'tables', op: 'add', hasArgs: false, re: new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?${NAME}`, 'gi') },
  { kind: 'tables', op: 'drop', hasArgs: false, re: new RegExp(String.raw`\bdrop\s+(?:materialized\s+)?(?:table|view)\s+(?:if\s+exists\s+)?${NAME}`, 'gi') },
  { kind: 'tables', op: 'rename', hasArgs: false, re: new RegExp(String.raw`\balter\s+(?:materialized\s+)?(?:table|view)\s+(?:if\s+exists\s+)?(?:only\s+)?${NAME}`, 'gi') },
];

/** What an ALTER does to the object's place: renames it, moves it out of public, or nothing. */
function alteration(sql: string, from: number): { op: 'rename' | 'leave' | null; to?: string } {
  const end = sql.indexOf(';', from);
  const statement = sql.slice(from, end < 0 ? sql.length : end);
  const rename = /^\s*rename\s+to\s+"?(\w+)"?/i.exec(statement);
  if (rename !== null) return { op: 'rename', to: rename[1].toLowerCase() };
  const schema = /^\s*set\s+schema\s+"?(\w+)"?/i.exec(statement);
  if (schema !== null) return schema[1].toLowerCase() === 'public' ? { op: null } : { op: 'leave' };
  return { op: null };
}

function eventsOf(sql: string): SchemaEvent[] {
  const events: SchemaEvent[] = [];
  for (const pattern of PATTERNS) {
    for (const match of sql.matchAll(pattern.re)) {
      const index = match.index ?? 0;
      const schema = (match[1] ?? 'public').toLowerCase();
      if (schema !== 'public') {
        continue;
      }
      const name = match[2].toLowerCase();
      let signature: string | null = null;
      let after = index + match[0].length;
      if (pattern.kind === 'functions' && (pattern.op === 'add' || match[3] === '(')) {
        const args = balanced(sql, index + match[0].lastIndexOf('('));
        signature = args === null ? null : signatureOf(args);
        after = index + match[0].lastIndexOf('(') + (args?.length ?? 0) + 2;
      }
      if (pattern.op === 'rename') {
        const change = alteration(sql, after);
        if (change.op !== null) {
          events.push({ index, kind: pattern.kind, op: change.op, name, signature, to: change.to });
        }
        continue;
      }
      events.push({ index, kind: pattern.kind, op: pattern.op, name, signature });
    }
  }
  return events.sort((a, b) => a.index - b.index);
}

/**
 * The functions, tables and views of schema `public` after every migration,
 * in order. A name without a schema is public's, as the migrations' search
 * path makes it. Functions are tracked by signature, so dropping one overload
 * leaves the others; a name counts while any overload of it remains.
 */
export function schemaObjects(migrations: readonly Migration[]): SchemaObjects {
  const functions = new Map<string, Set<string>>();
  const tables = new Set<string>();
  for (const migration of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const event of eventsOf(scrubSql(migration.sql))) {
      if (event.kind === 'tables') {
        if (event.op === 'add') tables.add(event.name);
        if (event.op === 'drop' || event.op === 'leave' || event.op === 'rename') tables.delete(event.name);
        if (event.op === 'rename' && event.to !== undefined) tables.add(event.to);
        continue;
      }
      const overloads = functions.get(event.name) ?? new Set<string>();
      const signature = event.signature ?? '';
      if (event.op === 'add') {
        functions.set(event.name, overloads.add(signature));
        continue;
      }
      if (event.signature === null) {
        overloads.clear();
      } else {
        overloads.delete(signature);
      }
      if (overloads.size === 0) {
        functions.delete(event.name);
      }
      if (event.op === 'rename' && event.to !== undefined) {
        functions.set(event.to, (functions.get(event.to) ?? new Set<string>()).add(signature));
      }
    }
  }
  return { functions: new Set(functions.keys()), tables };
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
