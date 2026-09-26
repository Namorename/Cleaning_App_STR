import { z } from 'zod';

import { readCached } from '../read-cached';

const rows = z.array(z.object({ id: z.string(), notes: z.string().nullable().default(null) }));

test('fills what an older shape lacks', () => {
  expect(readCached(rows, [{ id: 'a' }], 'rows')).toEqual([{ id: 'a', notes: null }]);
});

test('names the first thing it cannot read, in one short line', () => {
  // Arrange
  const read = () => readCached(rows, [{ id: 'a' }, { id: 7 }], 'rows');

  // Act / Assert
  expect(read).toThrow(/^Cached rows unreadable at 1\.id: /);
  expect(read).toThrow(expect.objectContaining({ message: expect.stringMatching(/^.{1,200}$/) }));
});
