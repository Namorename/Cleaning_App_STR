import NetInfo from '@react-native-community/netinfo';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { withClient } from '@/testing/restored-cache';

import { addMedia, confirmMedia, uploadMediaFile, uploadVideoFile } from '../api';
import { discardFile } from '../file';
import { mediaKeys } from '../keys';
import { forgetLocalMedia } from '../local-store';
import type { TaskMedia } from '../schema';
import {
  clearUploadProgress,
  reportUploadProgress,
  uploadProgressSnapshot,
} from '../upload-progress';
import {
  attachMedia,
  mediaItemViews,
  mediaMutationKeys,
  useAttachMedia,
  useRemoveMedia,
  useUploadProgress,
  useWaitingMediaIds,
  type AttachMediaVariables,
} from '../use-media';

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
  uploadVideoFile: jest.fn(
    async ({
      storagePath,
    }: {
      storagePath: string;
      onProgress?: (s: number, t: number) => void;
    }) => {
      calls.push(`resumable:${storagePath}`);
    },
  ),
  confirmMedia: jest.fn(async (id: string) => {
    calls.push(`confirm:${id}`);
    return { id, uploaded_at: '2026-09-07T10:00:05+00:00' };
  }),
  fetchTaskMedia: jest.fn(),
  removeMedia: jest.fn(),
  signedMediaUrls: jest.fn(),
}));

jest.mock('../file', () => ({
  discardFile: jest.fn((uri: string) => {
    calls.push(`discard:${uri}`);
  }),
}));
jest.mock('../local-store', () => ({
  loadLocalMedia: jest.fn(async () => ({})),
  rememberLocalMedia: jest.fn(),
  forgetLocalMedia: jest.fn(async (id: string) => {
    calls.push(`forget:${id}`);
    return {};
  }),
}));
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));

beforeEach(() => {
  calls.length = 0;
  jest.clearAllMocks();
});

/** A video of a step, as the recording screen hands it to the queue. */
const video: AttachMediaVariables = {
  taskId: 't1',
  stepId: 's1',
  uri: 'file:///documents/task-media/m1.mp4',
  mediaId: 'm1',
  kind: 'video',
  mimeType: 'video/mp4',
  byteSize: 21_000_000,
  width: null,
  height: null,
  durationSec: 12.3,
  takenAt: '2026-10-09T08:00:00.000Z',
  source: 'camera',
};

/** The row add_task_media answers with: a file still on its way, unless said otherwise. */
function registered(overrides: Partial<TaskMedia> = {}): TaskMedia {
  return {
    id: 'm1',
    task_id: 't1',
    step_id: 's1',
    problem_id: null,
    kind: 'video',
    storage_path: 'host/task/m1.mp4',
    mime_type: 'video/mp4',
    duration_sec: 12.3,
    device_taken_at: video.takenAt,
    created_at: video.takenAt,
    uploaded_at: null,
    deleted_at: null,
    ...overrides,
  };
}

describe('a video in the chain', () => {
  beforeEach(() => {
    jest.mocked(addMedia).mockImplementation(async () => {
      calls.push('add');
      return registered();
    });
  });

  afterEach(() => {
    clearUploadProgress('m1');
    // Back to the photo row the rest of this file registers.
    jest.mocked(addMedia).mockImplementation(async () => {
      calls.push('add');
      return { storage_path: 'host/task/m1.jpg' } as TaskMedia;
    });
  });

  test('goes through the resumable upload, not the single request', async () => {
    await attachMedia(video, new QueryClient());

    expect(calls.slice(0, 3)).toEqual(['add', 'resumable:host/task/m1.mp4', 'confirm:m1']);
    expect(uploadMediaFile).not.toHaveBeenCalled();
    expect(uploadVideoFile).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'm1',
        storagePath: 'host/task/m1.mp4',
        uri: video.uri,
        mimeType: 'video/mp4',
        byteSize: 21_000_000,
      }),
    );
  });

  test('says how far it has got, for the tile to show', async () => {
    jest.mocked(uploadVideoFile).mockImplementationOnce(async ({ onProgress }) => {
      onProgress?.(7_000_000, 21_000_000);
      expect(uploadProgressSnapshot().m1).toBeCloseTo(1 / 3);
    });

    await attachMedia(video, new QueryClient());
  });

  test('once the server confirmed it, the file on the phone is removed and its record let go', async () => {
    // Arrange
    const client = new QueryClient();
    client.setQueryData(mediaKeys.local, { m1: { id: 'm1' } });

    // Act
    await attachMedia(video, client);

    // Assert: in that order — never before the server has it.
    expect(calls).toEqual([
      'add',
      'resumable:host/task/m1.mp4',
      'confirm:m1',
      `discard:${video.uri}`,
      'forget:m1',
    ]);
    expect(client.getQueryData(mediaKeys.local)).toEqual({});
  });

  test('a video the server did not confirm keeps its file, for the next try', async () => {
    jest.mocked(confirmMedia).mockRejectedValueOnce({ hint: 'serverErrors.mediaNotUploaded' });

    await expect(attachMedia(video, new QueryClient())).rejects.toMatchObject({
      hint: 'serverErrors.mediaNotUploaded',
    });

    expect(discardFile).not.toHaveBeenCalled();
    expect(forgetLocalMedia).not.toHaveBeenCalled();
  });

  test('a failed upload keeps it too', async () => {
    jest.mocked(uploadVideoFile).mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(attachMedia(video, new QueryClient())).rejects.toThrow('Network request failed');

    expect(confirmMedia).not.toHaveBeenCalled();
    expect(discardFile).not.toHaveBeenCalled();
  });

  test('replayed after the server confirmed it, sends nothing more and lets the file go', async () => {
    // Arrange: the file is gone already; there is nothing to send it from.
    jest
      .mocked(addMedia)
      .mockResolvedValueOnce(registered({ uploaded_at: '2026-10-09T08:01:00.000Z' }));

    // Act
    await attachMedia(video, new QueryClient());

    // Assert
    expect(uploadVideoFile).not.toHaveBeenCalled();
    expect(calls).toEqual(['confirm:m1', `discard:${video.uri}`, 'forget:m1']);
  });

  test('nothing waits for Wi-Fi: the upload sets off as soon as the attach runs', async () => {
    // Arrange: mobile data, and the queue online.
    jest.mocked(NetInfo.fetch).mockResolvedValue({
      type: 'cellular',
      isConnected: true,
    } as Awaited<ReturnType<typeof NetInfo.fetch>>);
    const client = new QueryClient({
      defaultOptions: { mutations: { networkMode: 'offlineFirst' } },
    });
    const { result } = await renderHook(() => useAttachMedia(), { wrapper: withClient(client) });

    // Act
    await act(async () => {
      result.current.mutate(video);
    });

    // Assert
    await waitFor(() => expect(uploadVideoFile).toHaveBeenCalledTimes(1));
    expect(NetInfo.fetch).not.toHaveBeenCalled();
  });
});

// A video takes minutes over mobile data; a photo of a step or of a chat
// message must not stand behind it.
describe('the queues', () => {
  test('a photo goes up while a video is still on its way', async () => {
    // Arrange: the video registers and then takes its time.
    jest.mocked(addMedia).mockImplementation(async (variables) => {
      calls.push('add');
      return variables.kind === 'video'
        ? registered()
        : ({ storage_path: 'host/task/p1.jpg' } as TaskMedia);
    });
    jest.mocked(uploadVideoFile).mockImplementationOnce(() => new Promise(() => undefined));
    const client = new QueryClient({
      defaultOptions: { mutations: { networkMode: 'offlineFirst' } },
    });
    const { result } = await renderHook(
      () => ({ video: useAttachMedia('video'), photo: useAttachMedia() }),
      { wrapper: withClient(client) },
    );

    // Act
    await act(async () => {
      result.current.video.mutate(video);
    });
    await waitFor(() => expect(uploadVideoFile).toHaveBeenCalled());
    await act(async () => {
      result.current.photo.mutate({
        ...video,
        mediaId: 'p1',
        kind: 'photo',
        mimeType: 'image/jpeg',
        durationSec: null,
      });
    });

    // Assert
    await waitFor(() =>
      expect(uploadMediaFile).toHaveBeenCalledWith('host/task/p1.jpg', video.uri, 'image/jpeg'),
    );
    jest.mocked(addMedia).mockImplementation(async () => {
      calls.push('add');
      return { storage_path: 'host/task/m1.jpg' } as TaskMedia;
    });
  });
});

describe('a removed file', () => {
  test('takes its progress with it', async () => {
    // Arrange: a video part of the way up.
    reportUploadProgress('m1', 7_000_000, 21_000_000);
    const client = new QueryClient();
    const { result } = await renderHook(() => useRemoveMedia(), { wrapper: withClient(client) });

    // Act
    await act(async () => {
      result.current.mutate({ taskId: 't1', mediaId: 'm1' });
    });

    // Assert
    expect(uploadProgressSnapshot().m1).toBeUndefined();
  });
});

describe('a photo in the chain', () => {
  test('keeps its file once confirmed: its tile still shows it', async () => {
    await attachMedia(
      { ...video, kind: 'photo', mimeType: 'image/jpeg', durationSec: null },
      new QueryClient(),
    );

    expect(uploadVideoFile).not.toHaveBeenCalled();
    expect(discardFile).not.toHaveBeenCalled();
    expect(forgetLocalMedia).not.toHaveBeenCalled();
  });
});

describe('what the tiles read of the queue', () => {
  // A tile redraws as each piece goes: the signal's listener is kept, not
  // let go and taken again on every redraw.
  test('the waiting ids listen to the signal once, however often they are redrawn', async () => {
    // Arrange: the client's own listener and the hook's, taken as it is drawn.
    const subscribe = jest.spyOn(onlineManager, 'subscribe');
    const { rerender, unmount } = await renderHook(() => useWaitingMediaIds(), {
      wrapper: withClient(new QueryClient()),
    });
    const takenAtFirst = subscribe.mock.calls.length;

    // Act
    for (let i = 0; i < 3; i += 1) {
      await rerender({});
    }

    // Assert
    expect(takenAtFirst).toBeGreaterThan(0);
    expect(subscribe).toHaveBeenCalledTimes(takenAtFirst);
    await unmount();
    subscribe.mockRestore();
  });

  test('an upload paused for lack of signal is waiting; one under way is not', async () => {
    // Arrange: one attach paused offline, one running.
    const client = new QueryClient();
    const never = new Promise<TaskMedia>(() => undefined);
    const start = (id: string, networkMode: 'online' | 'always') => {
      const mutation = client.getMutationCache().build(client, {
        mutationKey: mediaMutationKeys.attach,
        mutationFn: () => never,
        networkMode,
      });
      void mutation.execute({ ...video, mediaId: id });
    };
    onlineManager.setOnline(false);
    try {
      await act(async () => {
        start('paused', 'online');
        start('running', 'always');
      });

      // Act
      const { result } = await renderHook(() => useWaitingMediaIds(), {
        wrapper: withClient(client),
      });

      // Assert
      expect([...result.current]).toEqual(['paused']);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  // TanStack pauses a mutation that waits its turn in a scope just as it
  // pauses one without signal; only the second is «Ждёт сети».
  test('an upload queued behind another while online is not waiting for signal', async () => {
    // Arrange: two attaches of one scope, the first one running.
    const client = new QueryClient();
    const never = new Promise<TaskMedia>(() => undefined);
    const start = (id: string) => {
      const mutation = client.getMutationCache().build(client, {
        mutationKey: mediaMutationKeys.attach,
        mutationFn: () => never,
        networkMode: 'offlineFirst',
        scope: { id: 'media-attach' },
      });
      void mutation.execute({ ...video, mediaId: id });
    };
    await act(async () => {
      start('running');
      start('queued');
    });
    const queued = client.getMutationCache().getAll()[1];
    expect(queued.state.isPaused).toBe(true);

    // Act
    const { result } = await renderHook(() => useWaitingMediaIds(), {
      wrapper: withClient(client),
    });

    // Assert
    expect([...result.current]).toEqual([]);

    // And once the signal goes, the paused one says so at once.
    await act(async () => onlineManager.setOnline(false));
    try {
      expect([...result.current]).toEqual(['queued']);
    } finally {
      await act(async () => onlineManager.setOnline(true));
    }
  });

  test('the progress of an upload reaches the screen as it changes', async () => {
    const { result } = await renderHook(() => useUploadProgress());
    expect(result.current.m1).toBeUndefined();

    await act(async () => {
      jest.mocked(addMedia).mockResolvedValueOnce(registered());
      jest.mocked(uploadVideoFile).mockImplementationOnce(async ({ onProgress }) => {
        onProgress?.(10, 40);
      });
      jest.mocked(confirmMedia).mockImplementationOnce(() => new Promise(() => undefined));
      void attachMedia(video, new QueryClient());
    });

    await waitFor(() => expect(result.current.m1).toBe(0.25));
    clearUploadProgress('m1');
  });
});

describe('attachMedia', () => {
  test('registers, uploads onto the assigned path, then confirms', async () => {
    const row = await attachMedia(
      {
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
      },
      new QueryClient(),
    );

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
    await attachMedia(
      {
        ...ofMessage,
        message: {
          messageId: 'msg1',
          body: 'x',
          subject: { kind: 'task', id: 't1' },
          mediaExpected: 1,
        },
      },
      new QueryClient(),
    );

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

    await expect(attachMedia(ofMessage, new QueryClient())).rejects.toBe(expired);
    expect(calls).not.toContain('confirm:m1');
  });

  test('a refusal from the bucket stands as it was when the row is alive', async () => {
    const denied = { statusCode: '403', message: 'denied' };
    jest.mocked(uploadMediaFile).mockRejectedValueOnce(denied);

    await expect(attachMedia(ofMessage, new QueryClient())).rejects.toBe(denied);
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

  test('a file on its way says how far it has got, and whether it waits for signal', () => {
    // Arrange
    const media = [
      { ...base, id: 'sending', kind: 'video' as const },
      { ...base, id: 'waiting', kind: 'video' as const },
      { ...base, id: 'arrived', kind: 'video' as const, uploaded_at: '2026-10-09T08:01:00Z' },
    ];

    // Act
    const [sending, waiting, arrived] = mediaItemViews(
      media,
      {},
      {},
      new Set(['sending', 'waiting']),
      { waiting: new Set(['waiting']), progress: { sending: 0.4, waiting: 0.7, arrived: 1 } },
    );

    // Assert
    expect(sending).toMatchObject({
      status: 'uploading',
      progress: 0.4,
      isWaitingForNetwork: false,
    });
    expect(waiting).toMatchObject({
      status: 'uploading',
      progress: 0.7,
      isWaitingForNetwork: true,
    });
    expect(arrived.status).toBe('uploaded');
    expect(arrived.progress).toBeUndefined();
  });
});
