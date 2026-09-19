import { describe, expect, test } from 'vitest';

import { messageTiles, type OutgoingPhotoStates } from '../message-tiles';
import type { ChatMessageMedia } from '../schema';

const MESSAGE = '11111111-1111-4111-8111-111111111111';
const FIRST = '22222222-2222-4222-8222-222222222222';
const SECOND = '33333333-3333-4333-8333-333333333333';

const row = (id: string, uploadedAt: string | null): ChatMessageMedia => ({
  id,
  storage_path: `host/chat/thread/${id}.jpg`,
  uploaded_at: uploadedAt,
  created_at: '2026-09-18T10:00:00+00:00',
});

const NO_OUTGOING: OutgoingPhotoStates = new Map();
const NO_URLS: ReadonlyMap<string, string> = new Map();

const tiles = (over: Partial<Parameters<typeof messageTiles>[0]> = {}) =>
  messageTiles({
    messageId: MESSAGE,
    body: 'Ключи в боксе',
    rows: [],
    isOwn: false,
    outgoing: NO_OUTGOING,
    previews: {},
    urls: NO_URLS,
    pastUploadWindow: false,
    ...over,
  });

describe('a photo somebody else sent', () => {
  test('is on its way while its row has no file', () => {
    const drawn = tiles({ rows: [row(FIRST, null)] });

    expect(drawn).toEqual([
      { id: FIRST, url: null, status: 'awaited', hasRow: true, canRetry: false, canRemove: true },
    ]);
  });

  test('is a picture once the file has arrived', () => {
    const drawn = tiles({
      rows: [row(FIRST, '2026-09-18T10:01:00+00:00')],
      urls: new Map([[`host/chat/thread/${FIRST}.jpg`, 'https://signed/first']]),
    });

    expect(drawn[0]).toMatchObject({ status: 'uploaded', url: 'https://signed/first' });
  });

  test('offers the reader nothing to retry, whatever this panel is doing', () => {
    const drawn = tiles({
      rows: [row(FIRST, null)],
      outgoing: new Map([[FIRST, { messageId: MESSAGE, status: 'failed' as const }]]),
    });

    expect(drawn[0]).toMatchObject({ status: 'awaited', canRetry: false });
  });
});

describe('a photo this panel is sending', () => {
  test('is drawn from the file in the browser before the row has one', () => {
    const drawn = tiles({
      isOwn: true,
      rows: [row(FIRST, null)],
      outgoing: new Map([[FIRST, { messageId: MESSAGE, status: 'uploading' as const }]]),
      previews: { [FIRST]: 'blob:first' },
    });

    expect(drawn[0]).toMatchObject({ status: 'uploading', url: 'blob:first', canRetry: false });
  });

  test('can be tried again once it is refused and the file is still held', () => {
    const drawn = tiles({
      isOwn: true,
      rows: [row(FIRST, null)],
      outgoing: new Map([[FIRST, { messageId: MESSAGE, status: 'failed' as const }]]),
    });

    expect(drawn[0]).toMatchObject({ status: 'failed', hasRow: true, canRetry: true });
  });

  test('cannot be tried again after a reload, when the file is gone', () => {
    const drawn = tiles({ isOwn: true, rows: [row(FIRST, null)] });

    expect(drawn[0]).toMatchObject({ status: 'failed', hasRow: true, canRetry: false });
  });

  test('an expired photo is only ever cleared, never retried', () => {
    const drawn = tiles({
      isOwn: true,
      rows: [row(FIRST, null)],
      outgoing: new Map([[FIRST, { messageId: MESSAGE, status: 'expired' as const }]]),
    });

    expect(drawn[0]).toMatchObject({ status: 'expired', canRetry: false });
  });

  test('shows a photo whose registration never landed, with no row behind it', () => {
    const drawn = tiles({
      isOwn: true,
      outgoing: new Map([[SECOND, { messageId: MESSAGE, status: 'failed' as const }]]),
      previews: { [SECOND]: 'blob:second' },
    });

    expect(drawn).toEqual([
      {
        id: SECOND,
        url: 'blob:second',
        status: 'failed',
        hasRow: false,
        canRetry: true,
        canRemove: true,
      },
    ]);
  });

  test('counts a row once, even while the same photo sits in the queue', () => {
    const drawn = tiles({
      isOwn: true,
      rows: [row(FIRST, null)],
      outgoing: new Map([[FIRST, { messageId: MESSAGE, status: 'uploading' as const }]]),
    });

    expect(drawn).toHaveLength(1);
  });

  test('leaves the photos of another message alone', () => {
    const drawn = tiles({
      isOwn: true,
      outgoing: new Map([[SECOND, { messageId: 'another', status: 'uploading' as const }]]),
    });

    expect(drawn).toEqual([]);
  });
});

describe('a message with no words at all', () => {
  test('shows one grey tile rather than an empty bubble', () => {
    const drawn = tiles({ body: '' });

    expect(drawn).toEqual([
      {
        id: `${MESSAGE}:awaited`,
        url: null,
        status: 'awaited',
        hasRow: false,
        canRetry: false,
        canRemove: false,
      },
    ]);
  });

  test('shows its own photos once they are there, and no placeholder', () => {
    const drawn = tiles({ body: '', rows: [row(FIRST, '2026-09-18T10:01:00+00:00')] });

    expect(drawn).toHaveLength(1);
    expect(drawn[0].id).toBe(FIRST);
  });

  test('says nothing extra for a message that is only words', () => {
    expect(tiles()).toEqual([]);
  });
});

describe('a message older than the upload window', () => {
  test('stops promising a photo that is not coming', () => {
    const drawn = tiles({ rows: [row(FIRST, null)], pastUploadWindow: true });

    expect(drawn[0]).toMatchObject({ status: 'expired', hasRow: true, canRetry: false });
  });

  test('leaves the picture that did arrive alone', () => {
    const drawn = tiles({
      rows: [row(FIRST, '2026-09-18T10:01:00+00:00')],
      pastUploadWindow: true,
      urls: new Map([[`host/chat/thread/${FIRST}.jpg`, 'https://signed/first']]),
    });

    expect(drawn[0]).toMatchObject({ status: 'uploaded' });
  });

  test('says so on the placeholder of a wordless message, with nothing to remove', () => {
    // The photos were swept: no row is left to draw, and "on its way" here
    // would be a promise kept for ever. The id belongs to no row either, so
    // the tile must not offer a button that would act on nothing.
    const drawn = tiles({ body: '', pastUploadWindow: true });

    expect(drawn).toEqual([
      {
        id: `${MESSAGE}:expired`,
        url: null,
        status: 'expired',
        hasRow: false,
        canRetry: false,
        canRemove: false,
      },
    ]);
  });

  test('leaves the sender her own verdict, which is the more precise one', () => {
    const drawn = tiles({
      isOwn: true,
      rows: [row(FIRST, null)],
      outgoing: new Map([[FIRST, { messageId: MESSAGE, status: 'uploading' as const }]]),
      pastUploadWindow: true,
    });

    expect(drawn[0]).toMatchObject({ status: 'uploading' });
  });
});
