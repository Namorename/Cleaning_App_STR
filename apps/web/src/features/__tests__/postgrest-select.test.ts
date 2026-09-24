import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, test } from 'vitest';

import {
  complaintsIn,
  indexSchema,
} from '../../../../../packages/shared/src/testing/postgrest-select';
import * as apartments from '../apartments/api';
import * as chat from '../chat/api';
import * as problems from '../problems/api';
import * as settings from '../settings/api';
import * as supplies from '../supplies/api';
import * as tasks from '../tasks/api';
import * as team from '../team/api';
import * as workflow from '../workflow/api';

/**
 * Every select the panel sends must be one the server will answer.
 *
 * The same guard the phone has (`apps/mobile/src/features/__tests__/
 * postgrest-embeds.test.ts`), for the same two mistakes: an embed naming two
 * tables joined more than one way, and a column the table does not have,
 * whether a typo or a computed field whose migration is not in the cloud yet.
 * Both empty the screen and neither is a type error, because the select is a
 * string and the rows leave through zod.
 *
 * The readers take the client as an argument, so a recording one is passed.
 */

const recorded: { table: string; select: string }[] = [];

function recordingClient() {
  const answer = Promise.resolve({ data: [], error: null });

  const recorder = (table: string | null): Record<string, unknown> => {
    const self: Record<string, unknown> = {
      then: answer.then.bind(answer),
      catch: answer.catch.bind(answer),
      finally: answer.finally.bind(answer),
    };
    // Every call hands back the proxy itself, so a chain runs to its end and a
    // reader that sends a second request after the first gets to send it.
    // Handing back the bare target made `.select(...).eq(...)` throw on the
    // spot, and anything after the first select went unrecorded.
    const proxy: Record<string, unknown> = new Proxy(self, {
      get(target, property: string) {
        if (property in target) {
          return target[property];
        }
        if (property === 'select') {
          return (columns?: unknown) => {
            if (typeof columns === 'string' && table !== null) {
              recorded.push({ table, select: columns });
            }
            return proxy;
          };
        }
        return () => proxy;
      },
    });
    return proxy;
  };

  return {
    from: (table: string) => recorder(table),
    rpc: () => recorder(null),
    storage: { from: () => recorder(null) },
    auth: { getUser: () => answer },
  } as never;
}

const ANY_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';
const ANY_PROPERTY = 1;
const ANY_RESERVATION = 1;

/** Every read the panel makes. A reader added without a line here goes unguarded. */
const READERS: readonly ((client: never) => Promise<unknown>)[] = [
  (client) => apartments.fetchRegistry(client),
  (client) => apartments.fetchProperty(client, ANY_PROPERTY),
  (client) => apartments.fetchOpenCleanings(client),
  (client) => apartments.fetchReservations(client, ANY_PROPERTY),
  (client) => apartments.fetchMaintenanceTasks(client, ANY_PROPERTY),
  (client) => apartments.fetchPropertyProblems(client, ANY_PROPERTY),
  (client) => apartments.fetchChecklist(client, ANY_PROPERTY),
  (client) => apartments.fetchChecklistOwner(client, ANY_PROPERTY),
  (client) => chat.fetchMessages(client, ANY_ID),
  (client) => problems.fetchProblems(client),
  (client) => problems.fetchProblem(client, ANY_ID),
  (client) => problems.fetchProblemPhotos(client, ANY_ID),
  (client) => problems.fetchFixTaskSteps(client, ANY_ID),
  (client) => problems.fetchStaff(client),
  (client) => settings.fetchHostSettings(client),
  (client) => supplies.fetchCatalog(client),
  (client) => supplies.fetchCompanyLanguage(client),
  (client) => supplies.fetchSupplyRequests(client),
  (client) => tasks.fetchTasks(client),
  (client) => tasks.fetchStaff(client),
  (client) => tasks.fetchProperties(client),
  (client) => tasks.fetchTaskWork(client, ANY_ID),
  (client) => tasks.fetchTaskProblems(client, ANY_ID),
  (client) => tasks.fetchReservationGuest(client, ANY_RESERVATION),
  (client) => team.fetchStaff(client),
  (client) => team.fetchProperties(client),
  (client) => team.fetchCleanerLinks(client),
  (client) => workflow.fetchProcess(client, 'cleaning', null),
  (client) => workflow.fetchProcess(client, 'cleaning', ANY_PROPERTY),
];

const schema = indexSchema(
  readFileSync(join(__dirname, '../../../../../packages/shared/src/database.types.ts'), 'utf8'),
);

beforeAll(async () => {
  const client = recordingClient();
  for (const read of READERS) {
    // The rows never arrive and some readers throw on the empty answer; the
    // select string is already recorded by then.
    await read(client).catch(() => undefined);
  }
});

describe('the schema this test reasons about', () => {
  test('is parsed, not silently empty', () => {
    expect(schema.relationships.length).toBeGreaterThan(20);
    expect(schema.columns.get('chat_messages')?.has('author_role')).toBe(true);
    expect(schema.computed.get('properties')?.has('effective_cleaner_notes')).toBe(true);
  });

  test('refuses a column that is not there', () => {
    expect(complaintsIn(schema, 'chat_messages', 'id, autor_name')).toHaveLength(1);
  });
});

describe('every read the panel makes', () => {
  test('sends a select string', () => {
    // Some readers go through an RPC and send no select at all.
    expect(recorded.length).toBeGreaterThanOrEqual(20);
  });

  // fetchProperty sends two reads, and the empty answer of this client makes
  // a reader that parses the first before sending the second throw early —
  // leaving the second unguarded without a word. The count above would not
  // notice one select fewer.
  test('includes the office note, read from its own table', () => {
    expect(recorded.some((entry) => entry.table === 'property_internal_notes')).toBe(true);
  });

  test('names one relationship per embed and only columns the schema has', () => {
    const complaints = recorded.flatMap((entry) =>
      complaintsIn(schema, entry.table, entry.select),
    );

    expect(complaints).toEqual([]);
  });
});
