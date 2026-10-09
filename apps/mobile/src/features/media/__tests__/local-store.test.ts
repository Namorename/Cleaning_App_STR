import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  forgetLocalMedia,
  loadLocalMedia,
  rememberLocalMedia,
  rememberUploadUrl,
  toLocalRecord,
} from '../local-store';

const captured = {
  id: 'm1',
  kind: 'photo' as const,
  uri: 'file:///kept/m1.jpg',
  mimeType: 'image/jpeg',
  byteSize: 100,
  width: 1600,
  height: 1200,
  durationSec: null,
  takenAt: '2026-09-07T10:00:00+00:00',
  source: 'camera' as const,
};

/** A capture as it reads back: no upload under way has left an address yet. */
const remembered = { ...captured, uploadUrl: null };

const UPLOAD_URL = 'https://project.supabase.co/storage/v1/upload/resumable/upload-1';

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('remembers a capture and gives it back after a restart', async () => {
  await rememberLocalMedia(toLocalRecord(captured));

  await expect(loadLocalMedia()).resolves.toEqual({ m1: remembered });
});

describe('the address of a resumable upload', () => {
  const video = { ...captured, kind: 'video' as const, uri: 'file:///kept/m1.mp4' };

  test('is kept with its capture, so a restart resumes rather than restarts', async () => {
    await rememberLocalMedia(toLocalRecord(video));

    await rememberUploadUrl('m1', UPLOAD_URL);

    expect((await loadLocalMedia()).m1.uploadUrl).toBe(UPLOAD_URL);
  });

  test('is let go of when the storage says it expired', async () => {
    await rememberLocalMedia(toLocalRecord(video));
    await rememberUploadUrl('m1', UPLOAD_URL);

    await rememberUploadUrl('m1', null);

    expect((await loadLocalMedia()).m1.uploadUrl).toBeNull();
  });

  test('a record the build before it wrote still reads, with no address', async () => {
    // Arrange: written by 1.1.0, which knew nothing of resumable uploads.
    await AsyncStorage.setItem('str-ops.media-local', JSON.stringify({ m1: captured }));

    // Act
    const store = await loadLocalMedia();

    // Assert
    expect(store).toEqual({ m1: remembered });
  });

  test('is not written for a capture the phone does not remember', async () => {
    await rememberUploadUrl('unknown', UPLOAD_URL);

    await expect(loadLocalMedia()).resolves.toEqual({});
  });

  test('saved while another capture is remembered, loses neither', async () => {
    // Arrange: two writers of the same ledger, each reading it before writing.
    await rememberLocalMedia(toLocalRecord(video));

    // Act
    await Promise.all([
      rememberUploadUrl('m1', UPLOAD_URL),
      rememberLocalMedia(toLocalRecord({ ...captured, id: 'm2' })),
      rememberLocalMedia(toLocalRecord({ ...captured, id: 'm3' })),
    ]);

    // Assert
    const store = await loadLocalMedia();
    expect(Object.keys(store).sort()).toEqual(['m1', 'm2', 'm3']);
    expect(store.m1.uploadUrl).toBe(UPLOAD_URL);
  });
});

test('forgets one without touching the others', async () => {
  await rememberLocalMedia(toLocalRecord(captured));
  await rememberLocalMedia(toLocalRecord({ ...captured, id: 'm2' }));

  const rest = await forgetLocalMedia('m1');

  expect(Object.keys(rest)).toEqual(['m2']);
});

test('reads a corrupted store as empty rather than failing', async () => {
  await AsyncStorage.setItem('str-ops.media-local', '{not json');

  await expect(loadLocalMedia()).resolves.toEqual({});
});

test('drops a capture the old build remembered as zero bytes', async () => {
  // What the phone was left holding after a photo was measured before it had
  // moved: a record the server refuses every time, so retrying it is a loop.
  await rememberLocalMedia(toLocalRecord({ ...captured, id: 'stuck', byteSize: 0 }));
  await rememberLocalMedia(toLocalRecord(captured));

  await expect(loadLocalMedia()).resolves.toEqual({ m1: remembered });
});
