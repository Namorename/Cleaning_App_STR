import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fetchMessages } from '@/features/chat/api';
import { fetchHostSettings } from '@/features/host/api';
import { fetchProblemMedia, fetchTaskMedia } from '@/features/media/api';
import { fetchReportProperties } from '@/features/properties/api';
import { fetchMyProblems, fetchProblem } from '@/features/problems/api';
import { fetchTaskSteps } from '@/features/steps/api';
import { fetchMySupplyRequests, fetchSupplyRequest } from '@/features/supplies/api';
import { fetchFreeTasks, fetchMyTasks, fetchTask } from '@/features/tasks/api';

import {
  complaintsIn,
  indexSchema,
  joinCount,
} from '../../../../../packages/shared/src/testing/postgrest-select';

/**
 * Every select the phone sends must be one the server will answer.
 *
 * Two things go wrong with a select string and neither is a type error: the
 * string is data, the mocked tests parse whatever they are handed, and the
 * client's own types go unchecked because the rows leave through zod, which
 * takes `unknown`.
 *
 * An embed naming two tables joined more than one way, without saying which,
 * is refused whole — HTTP 300, no rows, empty screen. It surfaced on a real
 * phone as "Could not embed because more than one relationship was found for
 * 'tasks' and 'problems'": `tasks.problem_id` is the report a maintenance
 * task fixes, `problems.task_id` is the cleaning a problem was found during.
 *
 * A column the table does not have is refused the same way — 42703, empty
 * screen. It surfaced twice: as a typo, and as a computed field
 * (`effective_cleaner_notes`) whose migration had not reached the cloud when
 * the bundle asking for it did. The generator files computed fields under
 * `Functions`, not under the table's `Row`, so the guard reads both.
 *
 * The rule is checked against the same schema the client is typed with:
 * drive the readers, catch the select strings they send, and resolve every
 * field in them the way the server would.
 */

const mockRecorded: { table: string; select: string }[] = [];

jest.mock('@/lib/supabase', () => {
  const answer = Promise.resolve({ data: [], error: null });

  // The readers chain a different set of filters each, and none of that
  // matters here: anything called returns the same recorder, and awaiting it
  // yields no rows. Only `from` and `select` are remembered.
  const recorder = (table: string | null): Record<string, unknown> => {
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
            if (typeof columns === 'string' && table !== null) {
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
      rpc: () => recorder(null),
      storage: { from: () => recorder(null) },
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
  () => fetchMessages(ANY_ID),
  () => fetchReportProperties(),
];

const schema = indexSchema(
  readFileSync(join(__dirname, '../../../../../packages/shared/src/database.types.ts'), 'utf8'),
);

beforeAll(async () => {
  for (const read of READERS) {
    // The rows are not the point and never arrive: an empty answer makes some
    // readers throw on parse. The select string is already recorded by then.
    await read().catch(() => undefined);
  }
});

describe('the schema this test reasons about', () => {
  // A parse that quietly matched nothing would make every assertion below
  // pass, which is why the shape of the result is asserted first.
  test('is parsed, not silently empty', () => {
    expect(schema.relationships.length).toBeGreaterThan(20);
    expect(schema.relationships.every(item => item.table !== '')).toBe(true);
    expect(schema.columns.get('tasks')?.has('scheduled_date')).toBe(true);
    expect(schema.columns.get('expired_tasks_review')?.has('parent_name')).toBe(true);
  });

  test('still joins tasks and problems both ways, which is what makes the embed ambiguous', () => {
    expect(joinCount(schema, 'tasks', 'problems')).toBe(2);
  });

  test('knows a computed field as a column of its table', () => {
    expect(schema.computed.get('properties')?.has('effective_cleaner_notes')).toBe(true);
    expect(complaintsIn(schema, 'properties', 'id, effective_cleaner_notes')).toEqual([]);
  });

  test('and refuses a column that is not there, however it is spelled', () => {
    expect(complaintsIn(schema, 'properties', 'id, cleaner_notez')).toHaveLength(1);
    expect(complaintsIn(schema, 'tasks', 'notes:cleaner_notez::text')).toHaveLength(1);
    expect(complaintsIn(schema, 'tasks', 'property:property_id(name, cleaner_notez)')).toHaveLength(
      1,
    );
  });
});

describe('every read the cleaner makes', () => {
  test('sends a select string', () => {
    expect(mockRecorded.length).toBeGreaterThanOrEqual(READERS.length);
  });

  test('names one relationship per embed and only columns the schema has', () => {
    const complaints = mockRecorded.flatMap(entry =>
      complaintsIn(schema, entry.table, entry.select),
    );

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

  // A cleaning stands on a room, and a room's own name — "1 - 2109" — names a
  // door and no house. Every read that shows a place to a person has to bring
  // the house along, or the screen names something she cannot place. The rule
  // above only says an embed is unambiguous; this one says it is there at all.
  test('brings the house along wherever it shows a place', () => {
    const withPlace = mockRecorded.filter(entry =>
      ['tasks', 'problems', 'supply_requests'].includes(entry.table),
    );

    expect(withPlace.length).toBeGreaterThan(0);
    for (const entry of withPlace) {
      expect(entry.select).toContain('parent:parent_id(name)');
      expect(entry.select).toContain('hostaway_unit_id');
    }
  });
});
