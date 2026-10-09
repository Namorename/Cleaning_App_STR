import { AppState, type AppStateStatus } from 'react-native';

import { appPresence } from '../app-presence';
import { TUS_CHUNK_BYTES, tusUpload, type TusSource } from '../tus';

/**
 * iOS stops JavaScript in the background and cuts what was on the wire. A
 * request that dies that way is the system's doing, not the network's: the
 * upload waits for the app to come back and carries on from the server's
 * offset, and no try is spent on it.
 */

let listeners: ((state: AppStateStatus) => void)[] = [];

/** React Native's jest stand-in has no state of its own: the test says where the app is. */
function placeApp(state: AppStateStatus): void {
  Object.defineProperty(AppState, 'currentState', {
    value: state,
    configurable: true,
    writable: true,
  });
}

function moveApp(state: AppStateStatus): void {
  placeApp(state);
  listeners.forEach((listener) => listener(state));
}

const standIn = Object.getOwnPropertyDescriptor(AppState, 'currentState');

beforeEach(() => {
  listeners = [];
  placeApp('active');
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener);
    return {
      remove: () => {
        listeners = listeners.filter((item) => item !== listener);
      },
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  if (standIn !== undefined) {
    Object.defineProperty(AppState, 'currentState', standIn);
  }
});

describe('appPresence', () => {
  test('notices the app leaving the front while it watches', () => {
    const watch = appPresence.watchAway();
    expect(watch.hasLeft()).toBe(false);

    moveApp('background');
    moveApp('active');

    expect(watch.hasLeft()).toBe(true);
    watch.stop();
    expect(listeners).toHaveLength(0);
  });

  test('a watch started in the background has left already', () => {
    placeApp('background');

    expect(appPresence.watchAway().hasLeft()).toBe(true);
  });

  test('waits for the front only when the app is not in it', async () => {
    await expect(appPresence.untilInFront()).resolves.toBeUndefined();

    placeApp('background');
    let isBack = false;
    const back = appPresence.untilInFront().then(() => {
      isBack = true;
    });
    await Promise.resolve();
    expect(isBack).toBe(false);

    moveApp('active');
    await back;
    expect(isBack).toBe(true);
    expect(listeners).toHaveLength(0);
  });
});

test('a piece cut by the app going to the background is not a failure: the upload waits and resumes', async () => {
  // Arrange: the first piece is on the wire when she locks the phone.
  let offset = 0;
  const methods: string[] = [];
  const fetch = jest.fn(async (_url: string, init: RequestInit): Promise<Response> => {
    const method = init.method ?? 'GET';
    methods.push(method);
    const headers = init.headers as Record<string, string>;
    const answer = (status: number, extra: Record<string, string> = {}) =>
      ({
        status,
        headers: { get: (name: string) => extra[name] ?? null },
        text: async () => '',
      }) as unknown as Response;

    if (method === 'POST') {
      return answer(201, { Location: 'https://project.supabase.co/upload-1' });
    }
    if (method === 'HEAD') {
      return answer(200, { 'Upload-Offset': String(offset) });
    }
    if (methods.filter((name) => name === 'PATCH').length === 1) {
      moveApp('background');
      // iOS suspends the app; the request dies there, and the app comes back.
      setTimeout(() => moveApp('active'), 0);
      throw new TypeError('The network connection was lost.');
    }
    offset = Number(headers['Upload-Offset']) + (init.body as Uint8Array).length;
    return answer(204, { 'Upload-Offset': String(offset) });
  });
  const source: TusSource = {
    size: TUS_CHUNK_BYTES + 10,
    read: async (_offset, length) => new Uint8Array(length),
    close: () => undefined,
  };
  const sleep = jest.fn(async () => undefined);

  // Act
  await tusUpload(
    {
      endpoint: 'https://project.supabase.co/storage/v1/upload/resumable',
      apiKey: 'key',
      bucket: 'task-media',
      objectName: 'host/task/m1.mp4',
      contentType: 'video/mp4',
      byteSize: TUS_CHUNK_BYTES + 10,
      uploadUrl: null,
      saveUploadUrl: async () => undefined,
      accessToken: async () => 'token',
      openSource: async () => source,
    },
    { fetch, sleep, presence: appPresence, isOnline: () => true, onOffline: () => () => undefined },
  );

  // Assert
  expect(methods).toEqual(['POST', 'PATCH', 'HEAD', 'PATCH', 'PATCH']);
  expect(sleep).not.toHaveBeenCalled();
  expect(offset).toBe(TUS_CHUNK_BYTES + 10);
});
