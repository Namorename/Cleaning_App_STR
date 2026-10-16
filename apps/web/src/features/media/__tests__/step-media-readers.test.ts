import { describe, expect, test } from 'vitest';

import { fetchFixTaskSteps } from '@/features/problems/api';
import { fetchTaskWork } from '@/features/tasks/api';

/**
 * The two readers of a job's step media: the task drawer and the repair's
 * steps on the problem card. Both used to ask for the rows without `kind` and
 * showed everything as a picture, so a video came out as a broken image.
 */

const STEP = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const TASK = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

const MEDIA = [
  {
    id: 'dddddddd-dddd-4ddd-8ddd-000000000001',
    step_id: STEP,
    storage_path: 'h/t/s/photo.jpg',
    created_at: '2026-10-09T08:00:00+00:00',
    source: 'camera',
    kind: 'photo',
    duration_sec: null,
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-000000000002',
    step_id: STEP,
    storage_path: 'h/t/s/video.mp4',
    created_at: '2026-10-09T08:01:00+00:00',
    source: 'camera',
    kind: 'video',
    duration_sec: 65,
  },
];

function fakeClient() {
  const selects: { table: string; select: string }[] = [];

  const builder = (table: string) => {
    const rows = table === 'task_media' ? MEDIA : [];
    const result = Promise.resolve({ data: rows, error: null });
    const self: Record<string, unknown> = {
      then: result.then.bind(result),
      catch: result.catch.bind(result),
      finally: result.finally.bind(result),
    };
    for (const name of ['eq', 'is', 'not', 'order']) {
      self[name] = () => self;
    }
    self.select = (columns: string) => {
      selects.push({ table, select: columns });
      return self;
    };
    return self;
  };

  const storage = {
    from: () => ({
      createSignedUrls: (paths: string[]) =>
        Promise.resolve({
          data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
          error: null,
        }),
    }),
  };

  return { client: { from: builder, storage } as never, selects };
}

const mediaSelect = (selects: { table: string; select: string }[]): string =>
  selects.find((entry) => entry.table === 'task_media')?.select ?? '';

describe.each([
  ['the task drawer', fetchTaskWork],
  ['the repair steps of a problem', fetchFixTaskSteps],
])('%s', (_name, read) => {
  test('asks what kind each file is and how long a video runs', async () => {
    const { client, selects } = fakeClient();

    await read(client, TASK);

    const columns = mediaSelect(selects)
      .split(',')
      .map((column) => column.trim());
    expect(columns).toEqual(expect.arrayContaining(['kind', 'duration_sec']));
  });

  test('keeps the files grouped by step, each with its kind and its signed link', async () => {
    const { client } = fakeClient();

    const work = await read(client, TASK);

    expect(work.mediaByStep[STEP]).toEqual([
      expect.objectContaining({ kind: 'photo', url: 'https://signed/h/t/s/photo.jpg' }),
      expect.objectContaining({
        kind: 'video',
        duration_sec: 65,
        url: 'https://signed/h/t/s/video.mp4',
      }),
    ]);
  });
});
