import { describe, expect, test } from 'vitest';

import { fetchRegistry } from '@/features/apartments/api';
import { fetchProperties as fetchTaskProperties } from '@/features/tasks/api';
import { fetchProperties as fetchTeamProperties } from '@/features/team/api';

/**
 * The one rule every listing picker in the panel has to keep.
 *
 * An archived listing has left the company, and the only screen allowed to
 * show one is the Archive tab of the registry, which is where it gets brought
 * back from. Everywhere else has to ask the database to leave it out — one
 * line, as easy to forget on a new screen as it is to write.
 *
 * This suite is that line, stated once. It drives each reader with a client
 * that records the query instead of running it, so a picker added next month
 * without the filter fails here rather than in front of a manager who
 * schedules a cleaning for a flat the company no longer has.
 */

interface Recorded {
  table: string;
  filters: string[];
}

/**
 * A Supabase client that writes the query down and answers with nothing.
 *
 * Every builder method returns the builder, and the builder itself is
 * thenable — so the reader under test runs to completion whichever method it
 * ends on, and its parser sees an empty list.
 */
function recordingClient() {
  const calls: Recorded[] = [];

  const makeBuilder = (call: Recorded) => {
    const result = Promise.resolve({ data: [], error: null });
    const builder: Record<string, unknown> = {
      then: result.then.bind(result),
      catch: result.catch.bind(result),
      finally: result.finally.bind(result),
    };

    const chain = (name: string) => (column?: unknown, value?: unknown) => {
      if (typeof column === 'string') {
        call.filters.push(`${name}:${column}=${String(value)}`);
      }
      return builder;
    };

    for (const name of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'gte', 'lte']) {
      builder[name] = chain(name);
    }
    return builder;
  };

  const client = {
    from(table: string) {
      const call: Recorded = { table, filters: [] };
      calls.push(call);
      return makeBuilder(call);
    },
  };

  // The readers are typed against the real client; the shape above is all they
  // touch, and pretending otherwise would only hide what the test drives.
  return { client: client as never, calls };
}

const ARCHIVED_IS_OUT = 'neq:status=archived';

describe('every listing picker leaves the archive out', () => {
  test('the one that fills the listing field when a task is written', async () => {
    const { client, calls } = recordingClient();

    await fetchTaskProperties(client);

    const query = calls.find((call) => call.table === 'properties');
    expect(query, 'the reader never asked for properties').toBeDefined();
    expect(query?.filters).toContain(ARCHIVED_IS_OUT);
  });

  test('the one that offers listings when somebody is put on them', async () => {
    const { client, calls } = recordingClient();

    await fetchTeamProperties(client);

    const query = calls.find((call) => call.table === 'properties');
    expect(query, 'the reader never asked for properties').toBeDefined();
    expect(query?.filters).toContain(ARCHIVED_IS_OUT);
  });
});

describe('the registry is the exception, on purpose', () => {
  test('it reads the archive too — it is where a listing comes back from', async () => {
    const { client, calls } = recordingClient();

    await fetchRegistry(client);

    const query = calls.find((call) => call.table === 'properties');
    expect(query?.filters).not.toContain(ARCHIVED_IS_OUT);
  });
});

/**
 * The second rule, and the newer one: a room is not a listing.
 *
 * Nine of the seventy-nine listings hold rooms — thirty-one between them —
 * and each room is a `properties` row under `parent_id` so that cleanings,
 * checklists and processes work on it unchanged. The cost is that every
 * reader of `properties` now picks up rooms unless it says not to, and a flat
 * list is the wrong answer in all three places below for two different
 * reasons.
 *
 * For the team screen it is permanent: a cleaner is linked to a listing and
 * her rooms follow. For the registry and the task form it holds until those
 * screens show rooms as a branch under their listing.
 *
 * The filter asks `hostaway_unit_id`, never `parent_id`. The latter also
 * carries the combined-listing relationship — a part of a combined listing is
 * a real listing with its own calendar and belongs in every one of these lists.
 * Filtering on it would hide a listing a manager had just configured.
 */
const ROOMS_ARE_OUT = 'is:hostaway_unit_id=null';

describe('a room is not offered as a listing of its own', () => {
  test('not in the listing field of a task', async () => {
    const { client, calls } = recordingClient();

    await fetchTaskProperties(client);

    expect(calls.find((call) => call.table === 'properties')?.filters).toContain(ROOMS_ARE_OUT);
  });

  test('not when somebody is put on listings', async () => {
    const { client, calls } = recordingClient();

    await fetchTeamProperties(client);

    expect(calls.find((call) => call.table === 'properties')?.filters).toContain(ROOMS_ARE_OUT);
  });

  test('and not as a row of its own in the registry', async () => {
    const { client, calls } = recordingClient();

    await fetchRegistry(client);

    expect(calls.find((call) => call.table === 'properties')?.filters).toContain(ROOMS_ARE_OUT);
  });
});
