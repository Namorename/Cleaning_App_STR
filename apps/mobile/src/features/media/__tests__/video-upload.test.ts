import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { onlineManager } from '@tanstack/react-query';

import { uploadVideoFile } from '../api';
import { appPresence } from '../app-presence';
import { openFileChunks } from '../file';
import { loadLocalMedia, rememberLocalMedia, rememberUploadUrl } from '../local-store';
import { tusUpload, type TusRuntime, type TusUpload } from '../tus';

/**
 * The video's middle link of the chain: the resumable upload, wired to the
 * app's project, the signed-in session, the file on the phone and the record
 * that remembers where an upload stopped.
 */

const mockGetSession = jest.fn();
const mockRefreshSession = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      refreshSession: () => mockRefreshSession(),
    },
  },
}));

jest.mock('../tus', () => ({
  ...jest.requireActual('../tus'),
  tusUpload: jest.fn(async () => undefined),
}));

jest.mock('../file', () => ({
  openFileChunks: jest.fn(async () => ({ size: 1, read: jest.fn(), close: jest.fn() })),
}));

const UPLOAD_URL = 'https://project.supabase.co/storage/v1/upload/resumable/upload-1';

const record = {
  id: 'm1',
  kind: 'video' as const,
  uri: 'file:///documents/task-media/m1.mp4',
  mimeType: 'video/mp4',
  byteSize: 21_000_000,
  width: null,
  height: null,
  durationSec: 12.3,
  takenAt: '2026-10-09T08:00:00.000Z',
  source: 'camera' as const,
};

const upload = {
  mediaId: 'm1',
  storagePath: 'host-1/task-1/m1.mp4',
  uri: record.uri,
  mimeType: 'video/mp4',
  byteSize: 21_000_000,
};

/** What the chain handed the protocol on its last call. */
function handed(): { video: TusUpload; runtime: TusRuntime } {
  const [video, runtime] = jest.mocked(tusUpload).mock.calls.at(-1) ?? [];
  if (video === undefined || runtime === undefined) {
    throw new Error('Nothing was uploaded');
  }
  return { video, runtime };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

test('a video goes to the project’s resumable endpoint with the app’s key, onto its registered path', async () => {
  await uploadVideoFile(upload);

  expect(handed().video).toMatchObject({
    endpoint: 'https://project.supabase.co/storage/v1/upload/resumable',
    apiKey: 'test-publishable-key',
    bucket: 'task-media',
    objectName: 'host-1/task-1/m1.mp4',
    contentType: 'video/mp4',
    uploadUrl: null,
  });
});

test('resumes from the address an earlier attempt left in the local record', async () => {
  // Arrange: an attempt before the network dropped, or before the app was closed.
  await rememberLocalMedia(record);
  await rememberUploadUrl('m1', UPLOAD_URL);

  // Act
  await uploadVideoFile(upload);

  // Assert
  expect(handed().video.uploadUrl).toBe(UPLOAD_URL);
});

test('the address of a new upload is written into the local record at once', async () => {
  await rememberLocalMedia(record);
  await uploadVideoFile(upload);

  await handed().video.saveUploadUrl(UPLOAD_URL);

  expect((await loadLocalMedia()).m1.uploadUrl).toBe(UPLOAD_URL);
});

test('a ledger that cannot be written costs the resume, not the upload', async () => {
  // Arrange
  await rememberLocalMedia(record);
  await uploadVideoFile(upload);
  const full = new Error('No space left on device');
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(full);

  // Act
  await expect(handed().video.saveUploadUrl(UPLOAD_URL)).resolves.toBeUndefined();

  // Assert
  expect(Sentry.captureException).toHaveBeenCalledWith(full);
});

test('reads the file piece by piece from where the capture was kept', async () => {
  await uploadVideoFile(upload);

  await handed().video.openSource();

  expect(openFileChunks).toHaveBeenCalledWith(record.uri);
});

test('passes on how far it has got', async () => {
  const onProgress = jest.fn();

  await uploadVideoFile({ ...upload, onProgress });
  handed().video.onProgress?.(3, 4);

  expect(onProgress).toHaveBeenCalledWith(3, 4);
});

describe('the token', () => {
  test('is the session’s own, read when asked', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'jwt-1' } }, error: null });
    await uploadVideoFile(upload);

    await expect(handed().video.accessToken(false)).resolves.toBe('jwt-1');
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  test('is refreshed when the storage turned the last one down', async () => {
    mockRefreshSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-2' } },
      error: null,
    });
    await uploadVideoFile(upload);

    await expect(handed().video.accessToken(true)).resolves.toBe('jwt-2');
  });

  test('without a session there is nothing to upload as', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    await uploadVideoFile(upload);

    await expect(handed().video.accessToken(false)).rejects.toThrow(/session/i);
  });

  test('a refresh that failed hands its error on, for the upload to judge', async () => {
    const offline = { name: 'AuthRetryableFetchError', message: 'Failed to fetch' };
    mockRefreshSession.mockResolvedValue({ data: { session: null }, error: offline });
    await uploadVideoFile(upload);

    await expect(handed().video.accessToken(true)).rejects.toBe(offline);
  });
});

test('runs with the app’s own sense of signal and of being in front', async () => {
  await uploadVideoFile(upload);
  const { runtime } = handed();

  expect(runtime.presence).toBe(appPresence);
  onlineManager.setOnline(false);
  expect(runtime.isOnline()).toBe(false);
  onlineManager.setOnline(true);
  expect(runtime.isOnline()).toBe(true);
});

// The phone's copy is deleted once the server confirms: the file is checked
// against the size the server registered before a byte goes up.
test('carries the size the server registered, for the file to be checked against', async () => {
  await uploadVideoFile(upload);

  expect(handed().video.byteSize).toBe(21_000_000);
});

test('cuts the request on the wire the moment the queue loses its signal', async () => {
  // Arrange
  await uploadVideoFile(upload);
  const lost = jest.fn();

  // Act
  const stop = handed().runtime.onOffline(lost);
  onlineManager.setOnline(false);
  onlineManager.setOnline(true);

  // Assert: the loss is heard; coming back is not a loss.
  expect(lost).toHaveBeenCalledTimes(1);
  stop();
  onlineManager.setOnline(false);
  expect(lost).toHaveBeenCalledTimes(1);
  onlineManager.setOnline(true);
});
