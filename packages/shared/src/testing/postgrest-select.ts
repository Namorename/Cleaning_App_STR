/**
 * Resolves a PostgREST select string against the generated schema, the way
 * the server would, and complains about what the server would refuse.
 *
 * Test-only. Nothing at runtime exports the schema's relationships or its
 * columns (they live in a type), so the text `db:types` writes is parsed.
 * Both apps drive their readers against a recording client and hand the
 * select strings they caught to `complaintsIn`.
 *
 * Two mistakes are caught, both of which have reached a real phone:
 *
 * - an embed that names two tables joined more than one way without saying
 *   which (`tasks.problem_id` and `problems.task_id`): the server answers
 *   300 and the screen stays empty;
 * - a column the table does not have, or a computed field whose migration is
 *   not in the cloud yet (`effective_cleaner_notes`, 2026-09-17): the server
 *   answers 42703 and the screen stays empty.
 *
 * Neither is a type error: the select is a string and the rows leave through
 * zod, which takes `unknown`.
 */

export interface Relationship {
  table: string;
  columns: readonly string[];
  referencedRelation: string;
}

export interface SchemaIndex {
  relationships: readonly Relationship[];
  /** The columns of every table and view, by name. */
  columns: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Computed fields: functions taking one row of a table as their only
   * argument, which PostgREST exposes as columns of that table. The generator
   * files them under `Functions`, not under the table's `Row`.
   */
  computed: ReadonlyMap<string, ReadonlySet<string>>;
}

// An entry opens with `name: {`, or with a bare `name:` when it is an
// overloaded function written as a union of members.
const ENTRY = /^ {6}(\w+):/gm;
const ENTRY_LINE = /^ {6}(\w+): \{$/;
const ROW_HEAD = /^ {8}Row: \{$/;
const ROW_END = /^ {8}\}$/;
const COLUMN = /^ {10}(\w+)\??:/;
const RELATIONSHIP =
  /foreignKeyName: "[^"]+"\s+columns: \[([^\]]*)\]\s+isOneToOne: \w+\s+referencedRelation: "(\w+)"/g;
const ROW_ARGUMENT = /Args: \{\s*\w+: Database\["public"\]\["Tables"\]\["(\w+)"\]\["Row"\]\s*\}/g;

interface EntryStart {
  name: string;
  at: number;
}

function entryStarts(source: string): EntryStart[] {
  return [...source.matchAll(ENTRY)].map((match) => ({ name: match[1], at: match.index ?? 0 }));
}

/** The entry a position in the source belongs to: the last one opened before it. */
function entryAt(starts: readonly EntryStart[], at: number): string {
  return [...starts].reverse().find((start) => start.at < at)?.name ?? '';
}

function readColumns(source: string): Map<string, Set<string>> {
  const lines = source.split('\n').map((line) => line.replace(/\r$/, ''));
  const columns = new Map<string, Set<string>>();

  lines.forEach((line, index) => {
    const entry = ENTRY_LINE.exec(line);
    if (entry === null || !ROW_HEAD.test(lines[index + 1] ?? '')) {
      return;
    }
    const names = new Set<string>();
    for (let at = index + 2; at < lines.length && !ROW_END.test(lines[at]); at += 1) {
      const column = COLUMN.exec(lines[at]);
      if (column !== null) {
        names.add(column[1]);
      }
    }
    columns.set(entry[1], names);
  });

  return columns;
}

// A function taking a table's row is a computed field of that table. An
// overloaded one is a union whose members come in whatever order the generator
// picks (is_service_booking, 20260926140000), so every row argument counts,
// not only one that opens its entry.
function readComputed(source: string): Map<string, Set<string>> {
  const starts = entryStarts(source);
  const computed = new Map<string, Set<string>>();
  for (const match of source.matchAll(ROW_ARGUMENT)) {
    const field = entryAt(starts, match.index ?? 0);
    computed.set(match[1], new Set([...(computed.get(match[1]) ?? []), field]));
  }
  return computed;
}

function readRelationships(source: string): Relationship[] {
  const starts = entryStarts(source);

  return [...source.matchAll(RELATIONSHIP)].map((entry) => {
    return {
      table: entryAt(starts, entry.index ?? 0),
      columns: entry[1]
        .split(',')
        .map((column) => column.trim().replace(/"/g, ''))
        .filter(Boolean),
      referencedRelation: entry[2],
    };
  });
}

/** Index the text of `database.types.ts`. */
export function indexSchema(source: string): SchemaIndex {
  return {
    relationships: readRelationships(source),
    columns: readColumns(source),
    computed: readComputed(source),
  };
}

/** How many ways the server could join these two tables. */
export function joinCount(schema: SchemaIndex, from: string, to: string): number {
  const forward = schema.relationships.filter(
    (item) => item.table === from && item.referencedRelation === to,
  );
  if (from === to) {
    return forward.length;
  }
  const backward = schema.relationships.filter(
    (item) => item.table === to && item.referencedRelation === from,
  );
  return forward.length + backward.length;
}

interface Field {
  /** Everything before the parenthesis of an embed, or the whole scalar. */
  head: string;
  /** What an embed asks for inside its parentheses; null for a scalar. */
  children: string | null;
}

/** Splits one level of a select string into its fields, parentheses respected. */
function fieldsOf(select: string): Field[] {
  const found: Field[] = [];
  let depth = 0;
  let field = '';

  const take = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === '') {
      return;
    }
    const open = trimmed.indexOf('(');
    if (open === -1) {
      found.push({ head: trimmed, children: null });
      return;
    }
    found.push({
      head: trimmed.slice(0, open).trim(),
      children: trimmed.slice(open + 1, trimmed.lastIndexOf(')')),
    });
  };

  for (const character of select) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      take(field);
      field = '';
      continue;
    }
    field += character;
  }
  take(field);

  return found;
}

/** The table an embed resolves to, or a complaint explaining why it cannot. */
function resolveEmbed(
  schema: SchemaIndex,
  parent: string,
  head: string,
): { table: string } | { problem: string } {
  const named = head.startsWith('...') ? head.slice(3) : head;
  const target = named.includes(':') ? named.slice(named.indexOf(':') + 1) : named;

  if (target.includes('!')) {
    return { table: target.slice(0, target.indexOf('!')) };
  }

  const byColumn = schema.relationships.find(
    (item) => item.table === parent && item.columns.length === 1 && item.columns[0] === target,
  );
  if (byColumn) {
    return { table: byColumn.referencedRelation };
  }

  const ways = joinCount(schema, parent, target);
  if (ways === 1) {
    return { table: target };
  }
  if (ways === 0) {
    return { problem: `'${parent}' has no relationship to '${target}'` };
  }
  return {
    problem:
      `'${parent}' and '${target}' are joined ${ways} ways: name the foreign key column ` +
      `or hint the constraint, or the server answers 300 and the screen stays empty`,
  };
}

/** The column a scalar field reads: the alias, the cast and any JSON path stripped. */
function columnOf(head: string): string {
  const withoutCast = head.split('::')[0];
  const withoutAlias = withoutCast.includes(':')
    ? withoutCast.slice(withoutCast.indexOf(':') + 1)
    : withoutCast;
  return withoutAlias.split('->')[0].trim();
}

function scalarComplaint(schema: SchemaIndex, table: string, head: string): string | null {
  const column = columnOf(head);
  if (column === '*') {
    return null;
  }
  const known = schema.columns.get(table);
  if (known === undefined) {
    return `'${table}' is not a table or view of the schema`;
  }
  if (known.has(column) || schema.computed.get(table)?.has(column)) {
    return null;
  }
  return (
    `'${table}' has no column '${column}': a typo, or a computed field whose migration ` +
    `has not been pushed; the server answers 42703 and the screen stays empty`
  );
}

/**
 * Everything the server would refuse in this select against this table:
 * an ambiguous or unknown embed, an unknown column. Recurses into embeds.
 */
export function complaintsIn(schema: SchemaIndex, table: string, select: string): string[] {
  return fieldsOf(select).flatMap((field) => {
    if (field.children === null) {
      const complaint = scalarComplaint(schema, table, field.head);
      return complaint === null ? [] : [`${table} → ${field.head}: ${complaint}`];
    }
    const outcome = resolveEmbed(schema, table, field.head);
    if ('problem' in outcome) {
      return [`${table} → ${field.head}: ${outcome.problem}`];
    }
    return complaintsIn(schema, outcome.table, field.children);
  });
}
