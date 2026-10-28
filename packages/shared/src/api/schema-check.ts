/**
 * A small JSON Schema checker for the API's own spec (openapi.v1.json).
 *
 * The contract tests check real answers against the spec's schemas. A full
 * validator would be a new dependency for Deno and Node alike; the spec keeps
 * to a subset instead, and this checks exactly that subset. A keyword outside
 * it throws, so the spec cannot drift into something nobody checks.
 *
 * Supported: $ref (local), type (one or a list, "null" included), enum,
 * properties, required, additionalProperties (false), items, minimum, maximum,
 * minLength, maxLength, pattern, format (date, date-time, uuid). Annotations
 * (description, example, default, title, x-*) are read past.
 */

export interface SchemaIssue {
  readonly path: string;
  readonly message: string;
}

type Schema = Record<string, unknown>;

const ANNOTATIONS = new Set(['description', 'example', 'examples', 'default', 'title', 'deprecated']);
const KEYWORDS = new Set([
  '$ref',
  'type',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
]);

const FORMATS: Readonly<Record<string, RegExp>> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
};

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function fitsType(actual: string, wanted: string): boolean {
  return actual === wanted || (wanted === 'number' && actual === 'integer');
}

function resolve(root: Schema, ref: string): Schema {
  if (!ref.startsWith('#/')) {
    throw new Error(`Only local $ref is supported: ${ref}`);
  }
  let node: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    node = (node as Record<string, unknown> | undefined)?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  if (typeof node !== 'object' || node === null) {
    throw new Error(`Unresolved $ref ${ref}`);
  }
  return node as Schema;
}

/** Every way `value` fails `schema`; empty when it fits. `root` is the whole spec, for $ref. */
export function checkSchema(schema: Schema, value: unknown, root: Schema, path = '$'): SchemaIssue[] {
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key) && !ANNOTATIONS.has(key) && !key.startsWith('x-')) {
      throw new Error(`Schema keyword "${key}" at ${path} is outside the checked subset`);
    }
  }
  if (typeof schema.$ref === 'string') {
    return checkSchema(resolve(root, schema.$ref), value, root, path);
  }

  const issues: SchemaIssue[] = [];
  const actual = typeOf(value);
  if (schema.type !== undefined) {
    const wanted = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!wanted.some((type) => fitsType(actual, type))) {
      return [{ path, message: `is ${actual}, wanted ${wanted.join(' or ')}` }];
    }
  }
  if (actual === 'null') {
    return issues;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    issues.push({ path, message: `is not one of ${(schema.enum as unknown[]).join(', ')}` });
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      issues.push({ path, message: `is shorter than ${schema.minLength}` });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      issues.push({ path, message: `is longer than ${schema.maxLength}` });
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      issues.push({ path, message: `does not match ${schema.pattern}` });
    }
    if (typeof schema.format === 'string') {
      const format = FORMATS[schema.format];
      if (format === undefined) {
        throw new Error(`Format "${schema.format}" at ${path} is outside the checked subset`);
      }
      if (!format.test(value)) {
        issues.push({ path, message: `is not a ${schema.format}` });
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      issues.push({ path, message: `is below ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      issues.push({ path, message: `is above ${schema.maximum}` });
    }
  }

  if (Array.isArray(value) && typeof schema.items === 'object' && schema.items !== null) {
    value.forEach((item, i) => issues.push(...checkSchema(schema.items as Schema, item, root, `${path}[${i}]`)));
  }

  if (actual === 'object') {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const name of (schema.required ?? []) as string[]) {
      if (!(name in record)) {
        issues.push({ path, message: `misses required "${name}"` });
      }
    }
    for (const [name, item] of Object.entries(record)) {
      const property = properties[name];
      if (property !== undefined) {
        issues.push(...checkSchema(property, item, root, `${path}.${name}`));
      } else if (schema.additionalProperties === false) {
        issues.push({ path, message: `has "${name}", which the spec does not name` });
      }
    }
  }
  return issues;
}
