/**
 * openapi.v1.json from openapi.v1.yaml and registry.json (docs/api-v1.md §9).
 *
 * The YAML is written by hand; what follows from other sources is built here so
 * that it cannot disagree with them:
 *   - the tables of scopes, presets, the forbidden list and the operations, in
 *     place of the <!-- generated:… --> markers of info.description;
 *   - each operation's `security`, from its x-woom-scope, and a first line of
 *     its description naming the scope;
 *   - the headers each answer carries, from x-woom-headers;
 *   - curl, JavaScript and Python samples (x-codeSamples) for every operation.
 *
 * `npm run api:docs` writes the JSON; the parity test builds it again in memory
 * and fails when the committed file differs.
 */

import { parse } from 'yaml';

import type { ApiRegistry, Preset, ScopeEntry } from './registry';

type Json = Record<string, unknown>;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const HEADER_SETS: Readonly<Record<string, readonly string[]>> = {
  common: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  write: [
    'X-Request-Id',
    'RateLimit',
    'RateLimit-Policy',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Idempotent-Replayed',
  ],
};

const SAMPLE_UUID = '6f8d2c1e-5b7a-4e3f-9a10-2b4c6d8e0f12';
const SAMPLE_ID = 123456;

/** A JSON example as a Python literal, for the requests sample. */
function pythonLiteral(value: unknown, indent: string): string {
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string' || typeof value === 'number') return JSON.stringify(value);
  const inner = `${indent}    `;
  if (Array.isArray(value)) {
    return `[${value.map((item) => pythonLiteral(item, inner)).join(', ')}]`;
  }
  const entries = Object.entries(value as Json).map(
    ([k, v]) => `${inner}${JSON.stringify(k)}: ${pythonLiteral(v, inner)},`,
  );
  return entries.length === 0 ? '{}' : ['{', ...entries, `${indent}}`].join('\n');
}

export interface SpecOperation {
  readonly method: string;
  readonly path: string;
  readonly operation: Json;
}

/** Every operation of a spec, in document order. */
export function operationsOf(spec: Json): SpecOperation[] {
  const result: SpecOperation[] = [];
  for (const [path, item] of Object.entries((spec.paths ?? {}) as Record<string, Json>)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method] as Json | undefined;
      if (operation !== undefined) {
        result.push({ method: method.toUpperCase(), path, operation });
      }
    }
  }
  return result;
}

/** Where each exposed scope is used: operation ids, and `Schema.field` for a field-level scope. */
export function scopeUses(spec: Json): Map<string, string[]> {
  const uses = new Map<string, string[]>();
  const add = (scope: string, use: string) => uses.set(scope, [...(uses.get(scope) ?? []), use]);
  for (const { operation } of operationsOf(spec)) {
    const scope = operation['x-woom-scope'];
    if (typeof scope === 'string') {
      add(scope, String(operation.operationId));
    }
  }
  const schemas = ((spec.components as Json | undefined)?.schemas ?? {}) as Record<string, Json>;
  for (const [name, schema] of Object.entries(schemas)) {
    for (const [field, property] of Object.entries((schema.properties ?? {}) as Record<string, Json>)) {
      const scope = property['x-woom-scope'];
      if (typeof scope === 'string') {
        add(scope, `${name}.${field}`);
      }
    }
  }
  return uses;
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|');
}

function levelOf(scope: ScopeEntry): string {
  return scope.sensitivity === 'sensitive' ? '**sensitive**' : 'normal';
}

function scopesTable(registry: ApiRegistry, uses: Map<string, string[]>): string {
  const rows = registry.scopes.map((scope) => {
    const status = scope.status === 'exposed' ? 'available' : 'reserved';
    const where = (uses.get(scope.id) ?? []).map((use) => `\`${use}\``).join(', ') || '—';
    return `| \`${scope.id}\` | ${scope.group} | ${scope.action} | ${levelOf(scope)} | ${status} | ${where} |`;
  });
  return ['| Scope | Group | Action | Level | Status | Used by |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n');
}

const PRESET_TEXT: Readonly<Record<Preset, readonly [string, string, string]>> = {
  read_only: [
    '**Read only**',
    'every *normal* scope that reads',
    'a new normal read scope joins it; sensitive and writing scopes never do',
  ],
  operator: [
    '**Operator**',
    'Read only, plus creating and assigning tasks and cleanings',
    'new normal read scopes and new scopes marked for operators join it',
  ],
  full: [
    '**Full access**',
    'every available scope, sensitive ones included — treat the key like an admin password',
    'every scope added later joins it; the forbidden list never does',
  ],
  custom: ['**Custom**', 'exactly the scopes ticked', 'nothing joins it by itself'],
};

function presetsTable(registry: ApiRegistry, effective: (preset: Preset) => string[]): string {
  const rows = registry.presets.map((preset) => {
    const [name, rule, future] = PRESET_TEXT[preset];
    const now = preset === 'custom' ? '—' : effective(preset).map((id) => `\`${id}\``).join(', ');
    return `| ${name} (\`${preset}\`) | ${rule} | ${now} | ${future} |`;
  });
  return ['| Preset | Gives | Today | Scopes added later |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

function forbiddenTable(registry: ApiRegistry): string {
  const rows = registry.forbidden.map((entry) => `| \`${entry.id}\` | ${cell(entry.reason)} |`);
  return ['| Never granted | Why |', '| --- | --- |', ...rows].join('\n');
}

function operationsTable(spec: Json): string {
  const rows = operationsOf(spec).map(({ method, path, operation }) => {
    const scope = operation['x-woom-scope'];
    const needs = typeof scope === 'string' ? `\`${scope}\`` : 'any working key';
    return `| ${method} | \`${path}\` | ${needs} | ${cell(String(operation.summary ?? ''))} |`;
  });
  return ['| Method | Path | Scope | What it does |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

function resolveRef(spec: Json, node: Json): Json {
  const ref = node.$ref;
  if (typeof ref !== 'string') {
    return node;
  }
  let target: unknown = spec;
  for (const part of ref.slice(2).split('/')) {
    target = (target as Json)[part];
  }
  return target as Json;
}

function samplePath(spec: Json, path: string, operation: Json): string {
  const parameters = ((operation.parameters ?? []) as Json[]).map((p) => resolveRef(spec, p));
  const filled = path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const parameter = parameters.find((p) => p.in === 'path' && p.name === name);
    const schema = (parameter?.schema ?? {}) as Json;
    return schema.type === 'integer' ? String(SAMPLE_ID) : SAMPLE_UUID;
  });
  const query = parameters
    .filter((p) => p.in === 'query' && (p.schema as Json | undefined)?.example !== undefined)
    .map((p) => `${String(p.name)}=${String((p.schema as Json).example)}`);
  return query.length > 0 ? `${filled}?${query.join('&')}` : filled;
}

function sampleBody(spec: Json, operation: Json): unknown {
  const content = ((operation.requestBody as Json | undefined)?.content ?? {}) as Record<string, Json>;
  return content['application/json']?.example;
}

function codeSamples(spec: Json, method: string, path: string, operation: Json): Json[] {
  const url = samplePath(spec, path, operation);
  const scope = typeof operation['x-woom-scope'] === 'string' ? operation['x-woom-scope'] : 'any working key';
  const body = sampleBody(spec, operation);
  const json = body === undefined ? null : JSON.stringify(body);
  const pretty = body === undefined ? null : JSON.stringify(body, null, 2);
  const isWrite = method !== 'GET';

  const curl = [
    `# Needs: ${scope}`,
    `curl -s${isWrite ? ` -X ${method}` : ''} "$WOOM_API${url}" \\`,
    `  -H "Authorization: Bearer $WOOM_API_KEY"${isWrite ? ' \\' : ''}`,
    ...(isWrite
      ? ['  -H "Content-Type: application/json" \\', '  -H "Idempotency-Key: $(uuidgen)" \\', `  -d '${json ?? '{}'}'`]
      : []),
  ].join('\n');

  const js = [
    `// Needs: ${scope}`,
    `const response = await fetch(\`\${process.env.WOOM_API}${url}\`, {`,
    ...(isWrite ? [`  method: '${method}',`] : []),
    '  headers: {',
    '    Authorization: `Bearer ${process.env.WOOM_API_KEY}`,',
    ...(isWrite ? ["    'Content-Type': 'application/json',", "    'Idempotency-Key': crypto.randomUUID(),"] : []),
    '  },',
    ...(isWrite ? [`  body: JSON.stringify(${(pretty ?? '{}').replaceAll('\n', '\n  ')}),`] : []),
    '});',
    'const answer = await response.json();',
    'if (!response.ok) {',
    '  throw new Error(`${answer.code}: ${answer.title}`);',
    '}',
    'console.log(answer.data);',
  ].join('\n');

  const python = [
    `# Needs: ${scope}`,
    'import os',
    ...(isWrite ? ['import uuid'] : []),
    'import requests',
    '',
    `response = requests.${method.toLowerCase()}(`,
    `    f"{os.environ['WOOM_API']}${url}",`,
    '    headers={',
    `        "Authorization": f"Bearer {os.environ['WOOM_API_KEY']}",`,
    ...(isWrite ? ['        "Idempotency-Key": str(uuid.uuid4()),'] : []),
    '    },',
    ...(isWrite ? [`    json=${pythonLiteral(body ?? {}, '    ')},`] : []),
    '    timeout=30,',
    ')',
    'answer = response.json()',
    'if not response.ok:',
    '    raise RuntimeError(f"{answer[\'code\']}: {answer[\'title\']}")',
    'print(answer["data"])',
  ].join('\n');

  return [
    { lang: 'Shell', label: 'curl', source: curl },
    { lang: 'JavaScript', label: 'JavaScript', source: js },
    { lang: 'Python', label: 'Python', source: python },
  ];
}

function expandHeaders(operation: Json): void {
  for (const response of Object.values((operation.responses ?? {}) as Record<string, Json>)) {
    const set = response['x-woom-headers'];
    if (typeof set !== 'string') {
      continue;
    }
    const names = HEADER_SETS[set];
    if (names === undefined) {
      throw new Error(`Unknown x-woom-headers set "${set}"`);
    }
    delete response['x-woom-headers'];
    response.headers = Object.fromEntries(names.map((name) => [name, { $ref: `#/components/headers/${name}` }]));
  }
}

export interface BuildInput {
  readonly yaml: string;
  readonly registry: ApiRegistry;
  /** The preset rule (registry.ts effectiveScopes), passed in to keep this file free of JSON imports. */
  readonly effective: (preset: Preset) => string[];
}

export function buildSpec({ yaml, registry, effective }: BuildInput): Json {
  const spec = parse(yaml) as Json;

  for (const { method, path, operation } of operationsOf(spec)) {
    const scope = operation['x-woom-scope'];
    operation.security = [{ bearerAuth: typeof scope === 'string' ? [scope] : [] }];
    const needs = typeof scope === 'string' ? `**Scope:** \`${scope}\`` : '**Scope:** none — any working key';
    operation.description = operation.description === undefined
      ? needs
      : `${needs}\n\n${String(operation.description).trimEnd()}`;
    expandHeaders(operation);
    operation['x-codeSamples'] = codeSamples(spec, method, path, operation);
  }

  const info = spec.info as Json;
  const uses = scopeUses(spec);
  info.description = String(info.description)
    .replace('<!-- generated:scopes -->', scopesTable(registry, uses))
    .replace('<!-- generated:presets -->', presetsTable(registry, effective))
    .replace('<!-- generated:forbidden -->', forbiddenTable(registry))
    .replace('<!-- generated:operations -->', operationsTable(spec));
  return spec;
}

/** The file as `npm run api:docs` writes it. */
export function renderSpec(spec: Json): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}
