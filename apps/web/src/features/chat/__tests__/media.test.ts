import { describe, expect, test } from 'vitest';

import { ImageMetadataError } from '@str-ops/shared';

import {
  BASELINE_JPEG_BASE64,
  ascii,
  dirtyJpeg,
  fromBase64,
  metadataLeaks,
} from '../../../../../../packages/shared/src/testing/image-fixtures';
import { attachMessagePhoto, removeMessagePhoto } from '../media';

const MESSAGE = '11111111-1111-4111-8111-111111111111';
const MEDIA = '22222222-2222-4222-8222-222222222222';
const PATH = 'host/chat/thread/photo.jpg';

const PICKED_AT = Date.parse('2026-09-18T09:30:00+00:00');
const clean = fromBase64(BASELINE_JPEG_BASE64);

/** A picked file, as the dialog hands it over: a photo with nothing to remove. */
const file = new File([clean], 'photo.jpg', { type: 'image/jpeg', lastModified: PICKED_AT });

/** The bytes a recorded upload carried. */
async function uploadedBytes(body: unknown): Promise<Uint8Array> {
  return new Uint8Array(await (body as Blob).arrayBuffer());
}

const row = {
  id: MEDIA,
  storage_path: PATH,
  uploaded_at: null,
  created_at: '2026-09-18T10:01:00+00:00',
};

interface Answers {
  add_message_media?: unknown;
  confirm_task_media?: unknown;
  remove_task_media?: unknown;
  uploadError?: unknown;
  rpcError?: { name: string; error: unknown };
}

/**
 * What the panel says to the server, in order.
 *
 * The chain is three calls and the order is the point: the row is written
 * before the file, because the bucket admits the path only while its row is
 * waiting for one.
 */
function recordingClient(answers: Answers) {
  const calls: { name: string; args: unknown }[] = [];

  const client = {
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      if (answers.rpcError?.name === name) {
        return Promise.resolve({ data: null, error: answers.rpcError.error });
      }
      return Promise.resolve({
        data: (answers as Record<string, unknown>)[name] ?? null,
        error: null,
      });
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: unknown, options: unknown) => {
          calls.push({ name: 'upload', args: { bucket, path, body, options } });
          return Promise.resolve({ data: null, error: answers.uploadError ?? null });
        },
      }),
    },
  } as never;

  return { client, calls };
}

describe('attaching a photo to a message', () => {
  test('writes the row, then the file, then the confirmation', async () => {
    const { client, calls } = recordingClient({
      add_message_media: row,
      confirm_task_media: { ...row, uploaded_at: '2026-09-18T10:02:00+00:00' },
    });

    const confirmed = await attachMessagePhoto(client, {
      mediaId: MEDIA,
      messageId: MESSAGE,
      file,
    });

    expect(calls.map((call) => call.name)).toEqual([
      'add_message_media',
      'upload',
      'confirm_task_media',
    ]);
    expect(confirmed.uploaded_at).toBe('2026-09-18T10:02:00+00:00');
  });

  test('registers under the id the panel minted, so a retry replays', async () => {
    const { client, calls } = recordingClient({
      add_message_media: row,
      confirm_task_media: row,
    });

    await attachMessagePhoto(client, { mediaId: MEDIA, messageId: MESSAGE, file });

    expect(calls[0].args).toEqual({
      p_id: MEDIA,
      p_message_id: MESSAGE,
      p_mime_type: 'image/jpeg',
      p_byte_size: clean.length,
      p_device_taken_at: '2026-09-18T09:30:00.000Z',
      p_source: 'gallery',
    });
    expect(calls[2].args).toEqual({ p_id: MEDIA });
  });

  test('puts the file exactly where the server said, and nowhere else', async () => {
    const { client, calls } = recordingClient({
      add_message_media: { ...row, storage_path: 'host/chat/thread/assigned.webp' },
      confirm_task_media: row,
    });

    await attachMessagePhoto(client, { mediaId: MEDIA, messageId: MESSAGE, file });

    expect(calls[1].args).toEqual({
      bucket: 'task-media',
      path: 'host/chat/thread/assigned.webp',
      body: file,
      options: { contentType: 'image/jpeg', upsert: false },
    });
  });

  test('reads "already exists" as the replay it is and confirms anyway', async () => {
    const { client, calls } = recordingClient({
      add_message_media: row,
      confirm_task_media: { ...row, uploaded_at: '2026-09-18T10:02:00+00:00' },
      uploadError: { statusCode: '409', message: 'The resource already exists' },
    });

    const confirmed = await attachMessagePhoto(client, {
      mediaId: MEDIA,
      messageId: MESSAGE,
      file,
    });

    expect(calls.map((call) => call.name)).toContain('confirm_task_media');
    expect(confirmed.uploaded_at).toBe('2026-09-18T10:02:00+00:00');
  });

  test('stops at a refused upload rather than claiming a file that is not there', async () => {
    const { client, calls } = recordingClient({
      add_message_media: row,
      uploadError: { statusCode: '403', message: 'new row violates row-level security policy' },
    });

    await expect(
      attachMessagePhoto(client, { mediaId: MEDIA, messageId: MESSAGE, file }),
    ).rejects.toMatchObject({ statusCode: '403' });
    expect(calls.map((call) => call.name)).not.toContain('confirm_task_media');
  });

  test('a photo from a phone leaves the panel without its place, time and camera', async () => {
    // Arrange: what a manager's phone writes into a picture, GPS included.
    const fromPhone = new File([dirtyJpeg(clean)], 'IMG_2041.jpg', {
      type: 'image/jpeg',
      lastModified: PICKED_AT,
    });
    const { client, calls } = recordingClient({ add_message_media: row, confirm_task_media: row });

    // Act
    await attachMessagePhoto(client, { mediaId: MEDIA, messageId: MESSAGE, file: fromPhone });

    // Assert: stripped before the row is written, so the row declares the
    // size of what is uploaded, and a retry strips to the same bytes again.
    const sent = await uploadedBytes((calls[1].args as { body: unknown }).body);
    expect(metadataLeaks(sent)).toEqual([]);
    expect((calls[0].args as { p_byte_size: number }).p_byte_size).toBe(sent.length);
    expect((calls[1].args as { options: unknown }).options).toEqual({
      contentType: 'image/jpeg',
      upsert: false,
    });
    expect((calls[0].args as { p_device_taken_at: string }).p_device_taken_at).toBe(
      '2026-09-18T09:30:00.000Z',
    );
  });

  test('a file that cannot be read as a picture is not sent at all', async () => {
    const broken = new File([ascii('not a picture')], 'broken.jpg', {
      type: 'image/jpeg',
      lastModified: PICKED_AT,
    });
    const { client, calls } = recordingClient({ add_message_media: row });

    await expect(
      attachMessagePhoto(client, { mediaId: MEDIA, messageId: MESSAGE, file: broken }),
    ).rejects.toBeInstanceOf(ImageMetadataError);
    expect(calls).toEqual([]);
  });

  test('never uploads when the row expired before the file was picked', async () => {
    const { client, calls } = recordingClient({
      rpcError: {
        name: 'add_message_media',
        error: { hint: 'serverErrors.messageMediaExpired', message: 'expired' },
      },
    });

    await expect(
      attachMessagePhoto(client, { mediaId: MEDIA, messageId: MESSAGE, file }),
    ).rejects.toMatchObject({ hint: 'serverErrors.messageMediaExpired' });
    expect(calls.map((call) => call.name)).toEqual(['add_message_media']);
  });
});

describe('taking a photo back', () => {
  test('asks the server by id and nothing else; the file goes with retention', async () => {
    const { client, calls } = recordingClient({
      remove_task_media: { ...row, uploaded_at: null },
    });

    await removeMessagePhoto(client, MEDIA);

    expect(calls).toEqual([{ name: 'remove_task_media', args: { p_id: MEDIA } }]);
  });
});
