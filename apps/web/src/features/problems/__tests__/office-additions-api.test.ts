import { describe, expect, test } from 'vitest';

import { attachOfficeFile, fetchAdditions, publishOfficeFiles } from '../additions-api';
import { resolveProblem } from '../api';
import {
  fitWithin,
  OFFICE_PHOTO_MAX_BYTES,
  officeFileKind,
  refusalOf,
  VIDEO_TOLERANCE_SEC,
} from '../office-files';

/**
 * The office adds photos, videos and a comment to a task (owner, 2026-11-26; 20261126100000):
 * what the panel checks before a file is sent, the chain it sends one down, how a closing carries
 * them, and how the batches are read back.
 */

const PROBLEM_ID = '11111111-1111-4111-8111-111111111111';
const ADDITION_ID = '22222222-2222-4222-8222-222222222222';
const MEDIA_ID = '33333333-3333-4333-8333-333333333333';
const COMMENT_ID = '44444444-4444-4444-8444-444444444444';

describe('the files the office picks', () => {
  test('a picture is a photo, an mp4 or a mov a video, anything else is not sent', () => {
    expect(officeFileKind({ type: 'image/png' })).toBe('photo');
    expect(officeFileKind({ type: 'image/JPEG' })).toBe('photo');
    expect(officeFileKind({ type: 'video/mp4' })).toBe('video');
    expect(officeFileKind({ type: 'video/quicktime' })).toBe('video');
    expect(officeFileKind({ type: 'video/webm' })).toBeNull();
    expect(officeFileKind({ type: 'application/pdf' })).toBeNull();
  });

  test('a photo is held to every photo’s size', () => {
    expect(refusalOf({ size: OFFICE_PHOTO_MAX_BYTES }, 'photo', null, null)).toBeNull();
    expect(refusalOf({ size: OFFICE_PHOTO_MAX_BYTES + 1 }, 'photo', null, null)).toEqual({
      key: 'tooLarge',
      limit: 20,
    });
  });

  test('a video is held to the company’s megabytes and seconds, with the phone’s second over', () => {
    const limits = { maxSec: 120, maxMb: 100 };
    expect(refusalOf({ size: 100_000_000 }, 'video', 60, limits)).toBeNull();
    expect(refusalOf({ size: 100_000_001 }, 'video', 60, limits)).toEqual({
      key: 'tooLarge',
      limit: 100,
    });
    expect(refusalOf({ size: 1000 }, 'video', 120 + VIDEO_TOLERANCE_SEC, limits)).toBeNull();
    expect(refusalOf({ size: 1000 }, 'video', 123, limits)).toEqual({
      key: 'videoTooLong',
      limit: 120,
    });
  });

  test('a video whose length the browser cannot read is not sent', () => {
    expect(refusalOf({ size: 1000 }, 'video', null, { maxSec: 120, maxMb: 100 })).toEqual({
      key: 'videoUnreadable',
    });
  });

  test('a photo is drawn no larger than the phone sends, and never enlarged', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

interface Call {
  name: string;
  args: unknown;
}

/** A client that answers the media chain and records what it was asked. */
function chainClient(registered: { uploaded_at: string | null }) {
  const calls: Call[] = [];
  const uploads: string[] = [];
  const client = {
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      const data =
        name === 'add_office_media'
          ? { storage_path: 'host/problems/p/office/m.jpg', ...registered }
          : { storage_path: 'host/problems/p/office/m.jpg', uploaded_at: 'now' };
      return Promise.resolve({ data, error: null });
    },
    storage: {
      from: () => ({
        upload: (path: string) => {
          uploads.push(path);
          return Promise.resolve({ data: { path }, error: null });
        },
      }),
    },
  };
  return { client: client as never, calls, uploads };
}

describe('a file goes down the pipeline', () => {
  const file = new File(['x'.repeat(10)], 'kitchen.mp4', { type: 'video/mp4', lastModified: 0 });

  test('the row, the file onto its path, then the confirmation', async () => {
    const { client, calls, uploads } = chainClient({ uploaded_at: null });
    await attachOfficeFile(client, {
      mediaId: MEDIA_ID,
      additionId: ADDITION_ID,
      problemId: PROBLEM_ID,
      file,
      kind: 'video',
      durationSec: 42,
    });
    expect(calls.map((call) => call.name)).toEqual(['add_office_media', 'confirm_task_media']);
    expect(calls[0].args).toMatchObject({
      p_id: MEDIA_ID,
      p_addition_id: ADDITION_ID,
      p_problem_id: PROBLEM_ID,
      p_kind: 'video',
      p_mime_type: 'video/mp4',
      p_byte_size: 10,
      p_duration_sec: 42,
      p_source: 'gallery',
    });
    expect(uploads).toEqual(['host/problems/p/office/m.jpg']);
  });

  test('a file that arrived before is not sent again: a retry only learns so', async () => {
    const { client, calls, uploads } = chainClient({ uploaded_at: '2026-11-26T10:00:00Z' });
    await attachOfficeFile(client, {
      mediaId: MEDIA_ID,
      additionId: ADDITION_ID,
      problemId: PROBLEM_ID,
      file,
      kind: 'video',
      durationSec: 42,
    });
    expect(calls.map((call) => call.name)).toEqual(['add_office_media']);
    expect(uploads).toEqual([]);
  });

  test('a refusal of the row stops the chain and comes back as it is', async () => {
    const refusal = { message: 'Problem is resolved', hint: 'serverErrors.additionTaskClosed' };
    const client = {
      rpc: () => Promise.resolve({ data: null, error: refusal }),
      storage: { from: () => ({ upload: () => Promise.reject(new Error('not reached')) }) },
    };
    await expect(
      attachOfficeFile(client as never, {
        mediaId: MEDIA_ID,
        additionId: ADDITION_ID,
        problemId: PROBLEM_ID,
        file,
        kind: 'video',
        durationSec: 42,
      }),
    ).rejects.toBe(refusal);
  });

  test('«Добавить» publishes the batch by its id', async () => {
    const calls: Call[] = [];
    const client = {
      rpc: (name: string, args: unknown) => {
        calls.push({ name, args });
        return Promise.resolve({ data: {}, error: null });
      },
    };
    await publishOfficeFiles(client as never, ADDITION_ID);
    expect(calls).toEqual([{ name: 'publish_office_media', args: { p_addition_id: ADDITION_ID } }]);
  });
});

const PROBLEM_ROW = {
  id: PROBLEM_ID,
  property_id: 7,
  task_id: null,
  reported_by: null,
  title: 'Течёт кран',
  description: null,
  priority: 'normal',
  status: 'resolved',
  resolved_at: '2026-11-26T10:00:00+00:00',
  cancelled_at: null,
  cancel_reason: null,
  archived_at: null,
  created_at: '2026-11-25T08:00:00+00:00',
};

function resolveClient() {
  const calls: Call[] = [];
  const client = {
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve({ data: PROBLEM_ROW, error: null });
    },
  };
  return { client: client as never, calls };
}

describe('closing with what the manager adds', () => {
  test('nothing added: the call of before, to the letter', async () => {
    const { client, calls } = resolveClient();
    await resolveProblem(client, { problemId: PROBLEM_ID, completedBy: null });
    await resolveProblem(client, { problemId: PROBLEM_ID, completedBy: MEDIA_ID, closing: null });
    expect(calls).toEqual([
      { name: 'resolve_problem', args: { p_id: PROBLEM_ID, p_alone: true } },
      { name: 'resolve_problem', args: { p_id: PROBLEM_ID, p_completed_by: MEDIA_ID } },
    ]);
  });

  test('with a comment: the batch, the message’s id and the words', async () => {
    const { client, calls } = resolveClient();
    await resolveProblem(client, {
      problemId: PROBLEM_ID,
      completedBy: null,
      closing: { additionId: ADDITION_ID, comment: 'Кран заменён', commentId: COMMENT_ID },
    });
    expect(calls[0].args).toEqual({
      p_id: PROBLEM_ID,
      p_alone: true,
      p_addition_id: ADDITION_ID,
      p_comment_id: COMMENT_ID,
      p_comment: 'Кран заменён',
    });
  });

  test('with files only: the batch, and no words', async () => {
    const { client, calls } = resolveClient();
    await resolveProblem(client, {
      problemId: PROBLEM_ID,
      completedBy: MEDIA_ID,
      closing: { additionId: ADDITION_ID, comment: null, commentId: COMMENT_ID },
    });
    expect(calls[0].args).toEqual({
      p_id: PROBLEM_ID,
      p_completed_by: MEDIA_ID,
      p_addition_id: ADDITION_ID,
    });
  });
});

describe('the batches read back', () => {
  const ROWS = [
    {
      id: ADDITION_ID,
      problem_id: PROBLEM_ID,
      author_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      author_name: 'Пётр',
      stage: 'closing',
      created_at: '2026-11-26T09:59:00+00:00',
      published_at: '2026-11-26T10:00:00+00:00',
      files: [
        {
          id: 'f2',
          kind: 'video',
          storage_path: 'v.mp4',
          mime_type: 'video/mp4',
          duration_sec: 12.5,
          created_at: '2026-11-26T09:59:30+00:00',
          uploaded_at: '2026-11-26T09:59:40+00:00',
          deleted_at: null,
          purged_at: null,
        },
        {
          id: 'f1',
          kind: 'photo',
          storage_path: 'p.jpg',
          mime_type: 'image/jpeg',
          duration_sec: null,
          created_at: '2026-11-26T09:59:10+00:00',
          uploaded_at: '2026-11-26T09:59:20+00:00',
          deleted_at: null,
          purged_at: null,
        },
        {
          id: 'f3',
          kind: 'photo',
          storage_path: 'gone.jpg',
          mime_type: 'image/jpeg',
          duration_sec: null,
          created_at: '2026-11-26T09:59:50+00:00',
          uploaded_at: null,
          deleted_at: '2026-11-26T10:00:00+00:00',
          purged_at: null,
        },
      ],
      message: { id: COMMENT_ID, body: 'Кран заменён' },
    },
  ];

  test('each batch with its shown files in order, the photos signed, and the closing’s words', async () => {
    const signed: string[][] = [];
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      then: (resolve: (value: unknown) => void) => resolve({ data: ROWS, error: null }),
    };
    const client = {
      from: (table: string) => {
        expect(table).toBe('problem_additions');
        return query;
      },
      storage: {
        from: () => ({
          createSignedUrls: (paths: string[]) => {
            signed.push(paths);
            return Promise.resolve({
              data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
              error: null,
            });
          },
        }),
      },
    };

    const additions = await fetchAdditions(client as never, PROBLEM_ID);

    expect(signed).toEqual([['p.jpg']]);
    expect(additions).toHaveLength(1);
    expect(additions[0]).toMatchObject({
      id: ADDITION_ID,
      stage: 'closing',
      authorName: 'Пётр',
      comment: 'Кран заменён',
    });
    expect(additions[0].files.map((file) => [file.id, file.url])).toEqual([
      ['f1', 'https://signed/p.jpg'],
      ['f2', null],
    ]);
  });
});
