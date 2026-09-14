import { describe, expect, test } from 'vitest';

import { fetchTasks } from '../api';

/**
 * What the list of tasks asks the server for.
 *
 * Since the cleanings of the nine multi-unit listings moved onto rooms, the
 * joined listing name of such a task is the room's own — "1 - 2109" — and
 * names no building. Everything the manager does with that row afterwards
 * depends on the house coming along with it: the card is labelled by it, and
 * the search looks for it. Composing the two in the panel is only possible if
 * the query asked for both, so that is what this suite holds.
 *
 * The hint is the FOREIGN KEY COLUMN — `parent:parent_id(name)`. Neither of
 * the other two spellings works: `properties!parent_id` walks the relation
 * backwards and answers with an empty array, and the constraint name
 * `properties_parent_id_fkey` is not in the schema cache as a hint at all.
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

describe('the panel reads every task with the house it stands in', () => {
  test('the query joins the parent listing by its foreign key column', async () => {
    const { client, selects } = recordingClient();

    await fetchTasks(client);

    expect(selects.join(' ')).toContain('parent:parent_id(name)');
  });
});
