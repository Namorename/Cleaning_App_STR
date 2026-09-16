import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fetchHostSettings } from '@/features/host/api';
import { fetchProblemMedia, fetchTaskMedia } from '@/features/media/api';
import { fetchMyProblems, fetchProblem } from '@/features/problems/api';
import { fetchTaskSteps } from '@/features/steps/api';
import { fetchMySupplyRequests, fetchSupplyRequest } from '@/features/supplies/api';
import { fetchFreeTasks, fetchMyTasks, fetchTask } from '@/features/tasks/api';

/**
 * Every embed the phone asks for must name exactly one relationship.
 *
 * PostgREST refuses a whole query — HTTP 300, no rows, empty screen — when the
 * two tables it is asked to join are joined more than once and the request
 * does not say which way. That is not a typo a reviewer catches: the select
 * string is data, the mocked tests parse whatever they are handed, and the
 * client's own types go unchecked because the rows leave through zod, which
 * takes `unknown`. It surfaced on a real phone, as "Could not embed because
 * more than one relationship was found for 'tasks' and 'problems'" —
 * `tasks.problem_id` is the report a maintenance task fixes, `problems.task_id`
 * is the cleaning a problem was found during.
 *
 * So the rule is checked here, against the same schema the client is typed
 * with: drive the readers, catch the select strings they send, and resolve
 * every embed in them the way the server would. An embed may be spelled by
 * foreign key column (`problem:problem_id(...)`), hinted explicitly
 * (`tasks!tasks_problem_id_fkey(...)`), or named by table — and the last one
 * is only allowed where exactly one relationship exists to resolve it.
 */

const mockRecorded: { table: string; select: string }[] = [];

jest.mock('@/lib/supabase', () => {
  const answer = Promise.resolve({ data: [], error: null });

  // The readers chain a different set of filters each, and none of that
  // matters here: anything called returns the same recorder, and awaiting it
  // yields no rows. Only `from` and `select` are remembered.
  const recorder = (table: string): Record<string, unknown> => {
    const self: Record<string, unknown> = {
      then: answer.then.bind(answer),
      catch: answer.catch.bind(answer),
      finally: answer.finally.bind(answer),
    };
    return new Proxy(self, {
      get(target, property: string) {
        if (property in target) {
          return target[property];
        }
        if (property === 'select') {
          return (columns?: unknown) => {
            if (typeof columns === 'string') {
              mockRecorded.push({ table, select: columns });
            }
            return target;
          };
        }
        return () => target;
      },
    });
  };

  return {
    supabase: {
      from: (table: string) => recorder(table),
      rpc: () => recorder('rpc'),
      storage: { from: () => recorder('storage') },
    },
  };
});

const ANY_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';

/** Every read the app makes. A reader added without a line here goes unguarded. */
const READERS: readonly (() => Promise<unknown>)[] = [
  () => fetchMyTasks(ANY_ID),
  () => fetchFreeTasks(),
  () => fetchTask(ANY_ID),
  () => fetchMyProblems(),
  () => fetchProblem(ANY_ID),
  () => fetchMySupplyRequests(),
  () => fetchSupplyRequest(ANY_ID),
  () => fetchTaskMedia(ANY_ID),
  () => fetchProblemMedia(ANY_ID),
  () => fetchTaskSteps(ANY_ID),
  () => fetchHostSettings(),
];

interface Relationship {
  table: string;
  columns: readonly string[];
  referencedRelation: string;
}

/**
 * The relationships of the generated schema, read from the file `db:types`
 * writes. Nothing exports them at runtime — they live in a type — so the text
 * is parsed. A parse that quietly matched nothing would make every assertion
 * below pass, which is why the shape of the result is asserted first.
 */
function readRelationships(): Relationship[] {
  const path = join(__dirname, '../../../../../packages/shared/src/database.types.ts');
  const source = readFileSync(path, 'utf8');

  const tableStarts = [...source.matchAll(/^ {6}(\w+): \{$/gm)].map(match => ({
    name: match[1],
    at: match.index ?? 0,
  }));

  const entries = [
    ...source.matchAll(
      /foreignKeyName: "[^"]+"\s+columns: \[([^\]]*)\]\s+isOneToOne: \w+\s+referencedRelation: "(\w+)"/g,
    ),
  ];

  return entries.map(entry => {
    const at = entry.index ?? 0;
    const owner = [...tableStarts].reverse().find(start => start.at < at);
    return {
      table: owner?.name ?? '',
      columns: entry[1]
        .split(',')
        .map(column => column.trim().replace(/"/g, ''))
        .filter(Boolean),
      referencedRelation: entry[2],
    };
  });
}

const relationships = readRelationships();

/** How many ways the server could join these two tables. */
function joinCount(from: string, to: string): number {
  const forward = relationships.filter(item => item.table === from && item.referencedRelation === to);
  if (from === to) {
    return forward.length;
  }
  const backward = relationships.filter(item => item.table === to && item.referencedRelation === from);
  return forward.length + backward.length;
}

interface Embed {
  head: string;
  children: string;
}

/** Splits one level of a select string into its embeds, parentheses respected. */
function embedsOf(select: string): Embed[] {
  const found: Embed[] = [];
  let depth = 0;
  let field = '';

  const take = (text: string) => {
    const open = text.indexOf('(');
    if (open === -1) {
      return;
    }
    found.push({
      head: text.slice(0, open).trim(),
      children: text.slice(open + 1, text.lastIndexOf(')')),
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
function resolve(parent: string, head: string): { table: string } | { problem: string } {
  const target = head.includes(':') ? head.slice(head.indexOf(':') + 1) : head;

  if (target.includes('!')) {
    return { table: target.slice(0, target.indexOf('!')) };
  }

  const byColumn = relationships.find(
    item => item.table === parent && item.columns.length === 1 && item.columns[0] === target,
  );
  if (byColumn) {
    return { table: byColumn.referencedRelation };
  }

  const ways = joinCount(parent, target);
  if (ways === 1) {
    return { table: target };
  }
  if (ways === 0) {
    return { problem: `'${parent}' has no relationship to '${target}'` };
  }
  return {
    problem:
      `'${parent}' and '${target}' are joined ${ways} ways — name the foreign key column ` +
      `or hint the constraint, or the server answers 300 and the screen stays empty`,
  };
}

function complaintsIn(table: string, select: string): string[] {
  return embedsOf(select).flatMap(embed => {
    const outcome = resolve(table, embed.head);
    if ('problem' in outcome) {
      return [`${table} → ${embed.head}: ${outcome.problem}`];
    }
    return complaintsIn(outcome.table, embed.children);
  });
}

beforeAll(async () => {
  for (const read of READERS) {
    // The rows are not the point and never arrive: an empty answer makes some
    // readers throw on parse. The select string is already recorded by then.
    await read().catch(() => undefined);
  }
});

describe('the schema this test reasons about', () => {
  test('is parsed, not silently empty', () => {
    expect(relationships.length).toBeGreaterThan(20);
    expect(relationships.every(item => item.table !== '')).toBe(true);
  });

  test('still joins tasks and problems both ways, which is what makes the embed ambiguous', () => {
    expect(joinCount('tasks', 'problems')).toBe(2);
  });
});

describe('every read the cleaner makes', () => {
  test('sends a select string', () => {
    expect(mockRecorded.length).toBeGreaterThanOrEqual(READERS.length);
  });

  test('names one relationship per embed', () => {
    const complaints = mockRecorded.flatMap(entry => complaintsIn(entry.table, entry.select));

    expect(complaints).toEqual([]);
  });

  test('asks for the problem a maintenance task fixes by its foreign key column', () => {
    const tasks = mockRecorded.filter(entry => entry.table === 'tasks').map(entry => entry.select);

    expect(tasks.length).toBeGreaterThan(0);
    for (const select of tasks) {
      expect(select).toContain('problem:problem_id(');
      expect(select).not.toContain('problem:problems(');
    }
  });
});
