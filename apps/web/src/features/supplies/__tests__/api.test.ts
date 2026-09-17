import { describe, expect, test } from 'vitest';

import { fetchSupplyRequests } from '../api';

/**
 * What this list asks the server for.
 *
 * A report filed from a cleaning stands on the ROOM the cleaner was working,
 * and a room's own name — "1 - 2109" — names a door and no house. Everything
 * the manager then does with the row depends on the house coming along: the
 * card is labelled by it and the search looks for it. Composing the two in the
 * panel is only possible if the query asked for both.
 *
 * The hint is the FOREIGN KEY COLUMN — `parent:parent_id(name)`. Neither other
 * spelling works: `properties!parent_id` walks the relation backwards and
 * answers with an empty array, and the constraint name
 * `properties_parent_id_fkey` is not in the schema cache as a hint at all.
 * None of that is caught by `tsc` — postgrest-js encodes a bad select as a
 * SelectQueryError and the rows leave through `zod.parse(unknown)`, which
 * nobody reads the error type of. So the spelling is held here.
 */
function recordingClient() {
  const selects: string[] = [];

  const builder = () => {
    const result = Promise.resolve({ data: [], error: null });
    const self: Record<string, unknown> = {
      then: result.then.bind(result),
      catch: result.catch.bind(result),
      finally: result.finally.bind(result),
    };
    for (const name of ['eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'gte', 'lte']) {
      self[name] = () => self;
    }
    self.select = (columns?: unknown) => {
      if (typeof columns === 'string') {
        selects.push(columns);
      }
      return self;
    };
    return self;
  };

  // The reader is typed against the real client; the shape above is all it
  // touches, and pretending otherwise would only hide what the test drives.
  return { client: { from: () => builder() } as never, selects };
}

describe('the panel reads every supply request with the house it came from', () => {
  test('the query joins the parent listing by its foreign key column', async () => {
    const { client, selects } = recordingClient();

    await fetchSupplyRequests(client);

    expect(selects.join(' ')).toContain('parent:parent_id(name)');
  });

  // This string also leaves the system in the CSV, where a bare room name is
  // not merely obscure but ambiguous: nothing in the file says which building
  // "1 - 2109" belongs to.
  test('and asks which of the two kinds of child it is', async () => {
    const { client, selects } = recordingClient();

    await fetchSupplyRequests(client);

    expect(selects.join(' ')).toContain('hostaway_unit_id');
  });
});
