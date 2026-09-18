import { addMedia, uploadMediaFile } from '../api';
import type { TaskMedia } from '../schema';
import { attachMedia, mediaItemViews } from '../use-media';

const calls: string[] = [];

jest.mock('@/features/chat/api', () => ({
  sendMessage: jest.fn(async () => {
    calls.push('send');
    return {};
  }),
}));

jest.mock('../api', () => ({
  addMedia: jest.fn(async () => {
    calls.push('add');
    return { storage_path: 'host/task/m1.jpg' };
  }),
  uploadMediaFile: jest.fn(async (path: string) => {
    calls.push(`upload:${path}`);
  }),
  confirmMedia: jest.fn(async (id: string) => {
    calls.push(`confirm:${id}`);
    return { id, uploaded_at: '2026-09-07T10:00:05+00:00' };
  }),
  fetchTaskMedia: jest.fn(),
  removeMedia: jest.fn(),
  signedMediaUrls: jest.fn(),
}));

jest.mock('../file', () => ({ discardFile: jest.fn() }));
jest.mock('../local-store', () => ({
  loadLocalMedia: jest.fn(async () => ({})),
  rememberLocalMedia: jest.fn(),
  forgetLocalMedia: jest.fn(),
}));
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));

beforeEach(() => {
  calls.length = 0;
});

describe('attachMedia', () => {
  test('registers, uploads onto the assigned path, then confirms', async () => {
    const row = await attachMedia({
      taskId: 't1',
      stepId: 's1',
      uri: 'file:///tmp/m1.jpg',
      mediaId: 'm1',
      kind: 'photo',
      mimeType: 'image/jpeg',
      byteSize: 100,
      width: 1600,
      height: 1200,
      durationSec: null,
      takenAt: '2026-09-07T10:00:00+00:00',
    });

    expect(calls).toEqual(['add', 'upload:host/task/m1.jpg', 'confirm:m1']);
    expect(row.uploaded_at).not.toBeNull();
  });

  const ofMessage = {
    messageId: 'msg1',
    uri: 'file:///tmp/m1.jpg',
    mediaId: 'm1',
    kind: 'photo' as const,
    mimeType: 'image/jpeg',
    byteSize: 100,
    width: 1600,
    height: 1200,
    durationSec: null,
    takenAt: '2026-09-18T10:00:00+00:00',
  };

  test('a photo of a message says the message again before registering it', async () => {
    await attachMedia({
      ...ofMessage,
      message: {
        messageId: 'msg1',
        body: 'x',
        subject: { kind: 'task', id: 't1' },
        mediaExpected: 1,
      },
    });

    expect(calls).toEqual(['send', 'add', 'upload:host/task/m1.jpg', 'confirm:m1']);
  });

  test('a refusal from the bucket asks the registration again, so an expired row says so', async () => {
    const expired = { message: 'expired', hint: 'serverErrors.messageMediaExpired' };
    jest.mocked(uploadMediaFile).mockRejectedValueOnce({ statusCode: '403', message: 'denied' });
    jest
      .mocked(addMedia)
      .mockImplementationOnce(async () => ({ storage_path: 'host/chat/m1.jpg' }) as TaskMedia)
      .mockImplementationOnce(async () => {
        throw expired;
      });

    await expect(attachMedia(ofMessage)).rejects.toBe(expired);
    expect(calls).not.toContain('confirm:m1');
  });

  test('a refusal from the bucket stands as it was when the row is alive', async () => {
    const denied = { statusCode: '403', message: 'denied' };
    jest.mocked(uploadMediaFile).mockRejectedValueOnce(denied);

    await expect(attachMedia(ofMessage)).rejects.toBe(denied);
  });
});

describe('mediaItemViews', () => {
  const base: TaskMedia = {
    id: 'm1',
    task_id: 't1',
    step_id: 's1',
    kind: 'photo',
    storage_path: 'host/task/m1.jpg',
    mime_type: 'image/jpeg',
    duration_sec: null,
    device_taken_at: null,
    created_at: '2026-09-07T10:00:01+00:00',
    uploaded_at: null,
    deleted_at: null,
    problem_id: null,
  };

  const local = {
    m1: {
      id: 'm1',
      kind: 'photo' as const,
      uri: 'file:///kept/m1.jpg',
      mimeType: 'image/jpeg',
      byteSize: 100,
      width: null,
      height: null,
      durationSec: null,
      takenAt: '2026-09-07T10:00:00+00:00',
    },
  };

  test('shows the phone’s own file first, then the signed link', () => {
    const urls = { 'host/task/m1.jpg': 'https://signed/m1' };

    expect(mediaItemViews([base], local, urls, new Set())[0].uri).toBe('file:///kept/m1.jpg');
    expect(mediaItemViews([base], {}, urls, new Set())[0].uri).toBe('https://signed/m1');
    expect(mediaItemViews([base], {}, {}, new Set())[0].uri).toBeNull();
  });

  test('tells a file on its way from one that was stranded', () => {
    const uploaded = { ...base, uploaded_at: '2026-09-07T10:00:05+00:00' };

    expect(mediaItemViews([base], {}, {}, new Set(['m1']))[0].status).toBe('uploading');
    expect(mediaItemViews([base], {}, {}, new Set())[0].status).toBe('failed');
    expect(mediaItemViews([uploaded], {}, {}, new Set())[0].status).toBe('uploaded');
  });
});
