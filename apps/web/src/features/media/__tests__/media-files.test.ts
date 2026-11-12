import { describe, expect, test, vi } from 'vitest';

import { signFile, withSignedUrls, type SignedFile } from '@/lib/media';

import { MediaFiles } from '../media-files';
import { downloadName, type ViewerItem } from '../viewer-item';

/**
 * What the viewer holds and how it names what it saves: links signed when a
 * file is opened, bytes kept in memory only, a file storage no longer has
 * called gone, and a download saved under a name a person can read.
 */

const photo = (id: string): ViewerItem => ({
  id,
  kind: 'photo',
  path: `h/t/${id}.jpg`,
  createdAt: '2026-10-09T09:00:00+00:00',
});

/** A load the test answers by hand. */
function heldSigning() {
  const pending: ((answer: SignedFile) => void)[] = [];
  const sign = vi.fn(
    () => new Promise<SignedFile>((resolve) => pending.push(resolve)),
  );
  return { sign, answer: (url: string) => pending.shift()?.({ status: 'signed', url }) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('MediaFiles', () => {
  test('signs nothing until it is asked to hold a file', () => {
    const sign = vi.fn();
    new MediaFiles({ sign });

    expect(sign).not.toHaveBeenCalled();
  });

  test('drops a load let go of before it answered, and frees its bytes', async () => {
    const { sign, answer } = heldSigning();
    const revoke = vi.fn();
    const files = new MediaFiles({
      sign,
      fetchFile: vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }) as Response),
      createObjectUrl: () => 'blob:late',
      revokeObjectUrl: revoke,
    });

    files.keep([photo('p1')]);
    files.keep([photo('p2')]);
    answer('https://signed/p1');
    await flush();

    expect(files.getSnapshot().has('p1')).toBe(false);
    expect(revoke).toHaveBeenCalledWith('blob:late');
  });

  test('frees every photo it holds when the viewer closes', async () => {
    const revoke = vi.fn();
    const files = new MediaFiles({
      sign: async (path) => ({ status: 'signed', url: `https://signed/${path}` }),
      fetchFile: vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }) as Response),
      createObjectUrl: () => 'blob:held',
      revokeObjectUrl: revoke,
    });
    files.keep([photo('p1')]);
    await flush();
    expect(files.getSnapshot().get('p1')).toEqual({ status: 'ready', src: 'blob:held' });

    files.clear();

    expect(revoke).toHaveBeenCalledWith('blob:held');
    expect(files.getSnapshot().size).toBe(0);
  });

  test('a photo whose bytes would not draw fails, and lets the bytes go', async () => {
    const revoke = vi.fn();
    const files = new MediaFiles({
      sign: async (path) => ({ status: 'signed', url: `https://signed/${path}` }),
      fetchFile: vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }) as Response),
      createObjectUrl: () => 'blob:cut-short',
      revokeObjectUrl: revoke,
    });
    files.keep([photo('p1')]);
    await flush();

    files.photoBroken(photo('p1'), 'blob:cut-short');

    expect(files.getSnapshot().get('p1')).toEqual({ status: 'failed' });
    expect(revoke).toHaveBeenCalledWith('blob:cut-short');
  });

  test('an error from a video link already replaced changes nothing', async () => {
    let signed = 0;
    const video: ViewerItem = { ...photo('v1'), kind: 'video', path: 'h/t/v1.mp4' };
    const files = new MediaFiles({
      sign: async () => ({ status: 'signed', url: `https://signed/v1?n=${(signed += 1)}` }),
    });
    files.keep([video]);
    await flush();

    files.videoFailed(video, 'https://signed/v1?n=1');
    await flush();
    expect(files.getSnapshot().get('v1')).toEqual({
      status: 'ready',
      src: 'https://signed/v1?n=2',
    });

    files.videoFailed(video, 'https://signed/v1?n=1');
    expect(files.getSnapshot().get('v1')).toEqual({
      status: 'ready',
      src: 'https://signed/v1?n=2',
    });
  });
});

describe('signFile', () => {
  const clientAnswering = (answer: { data: unknown; error: unknown }) => {
    const createSignedUrl = vi.fn(async () => answer);
    return {
      client: { storage: { from: () => ({ createSignedUrl }) } } as never,
      createSignedUrl,
    };
  };

  test('hands back a fresh link for an hour', async () => {
    const { client, createSignedUrl } = clientAnswering({
      data: { signedUrl: 'https://signed/x' },
      error: null,
    });

    await expect(signFile(client, 'h/t/x.jpg')).resolves.toEqual({
      status: 'signed',
      url: 'https://signed/x',
    });
    expect(createSignedUrl).toHaveBeenCalledWith('h/t/x.jpg', 3600);
  });

  test.each([
    { statusCode: '404', message: 'Object not found' },
    { code: 'NoSuchKey', message: 'The resource was not found' },
  ])('calls a file storage does not have missing: %o', async (error) => {
    const { client } = clientAnswering({ data: null, error });

    await expect(signFile(client, 'h/t/gone.jpg')).resolves.toEqual({ status: 'missing' });
  });

  test('passes any other refusal on', async () => {
    const { client } = clientAnswering({
      data: null,
      error: { statusCode: '500', message: 'internal' },
    });

    await expect(signFile(client, 'h/t/x.jpg')).rejects.toMatchObject({ statusCode: '500' });
  });
});

describe('withSignedUrls', () => {
  test('signs only the rows a list draws a picture of', async () => {
    const createSignedUrls = vi.fn(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
      error: null,
    }));
    const client = { storage: { from: () => ({ createSignedUrls }) } } as never;

    const rows = await withSignedUrls(
      client,
      [
        { storage_path: 'a.jpg', kind: 'photo' },
        { storage_path: 'b.mp4', kind: 'video' },
      ],
      (row) => row.kind === 'photo',
    );

    expect(createSignedUrls).toHaveBeenCalledWith(['a.jpg'], 3600);
    expect(rows.map((row) => row.url)).toEqual(['https://signed/a.jpg', null]);
  });
});

describe('downloadName', () => {
  test('says what the file is, when it was taken and where it stands in the set', () => {
    const at = new Date(2026, 9, 9, 14, 5);
    const item = { ...photo('p1'), createdAt: at.toISOString() };

    expect(downloadName(item, 3)).toBe('photo-2026-10-09-1405-3.jpg');
  });

  test('keeps the file’s own extension, lower case, and gives one to a file without', () => {
    const at = new Date(2026, 9, 9, 8, 0).toISOString();

    expect(
      downloadName({ id: 'v', kind: 'video', path: 'h/t/v.MOV', createdAt: at }, 1),
    ).toBe('video-2026-10-09-0800-1.mov');
    expect(downloadName({ id: 'p', kind: 'photo', path: 'h/t/noext', createdAt: at }, 2)).toBe(
      'photo-2026-10-09-0800-2.jpg',
    );
  });

  test('names a file with an unreadable time by its place alone', () => {
    expect(downloadName({ ...photo('p1'), createdAt: '' }, 4)).toBe('photo-4.jpg');
  });
});
