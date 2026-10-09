import {
  ENDPOINT,
  OBJECT,
  SIZE,
  UPLOAD_URL,
  decodeMetadata,
  file,
  runtime,
  setUpTusStorage,
  storage,
  upload,
  videoFile,
} from '@/testing/tus-storage';

import { TUS_CHUNK_BYTES, TusFileError, TusRefusedError, tusUpload, type TusSource } from '../tus';

/**
 * The resumable upload of a video (docs/tech-plan.md §7.5) as it begins: the
 * upload created with its place in the bucket, the address the storage gives
 * it and where that may point, and the file on the phone it is read from.
 */

setUpTusStorage();

describe('a new upload', () => {
  test('is created with the protocol’s headers, its place in the bucket, and no upsert', async () => {
    // Arrange
    const video = upload();

    // Act
    await tusUpload(video, runtime());

    // Assert
    const [create] = storage.calls;
    expect(create.method).toBe('POST');
    expect(create.url).toBe(ENDPOINT);
    expect(create.headers).toMatchObject({
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(SIZE),
      Authorization: 'Bearer token-1',
      apikey: 'test-publishable-key',
    });
    expect(decodeMetadata(create.headers['Upload-Metadata'])).toEqual({
      bucketName: 'task-media',
      objectName: OBJECT,
      contentType: 'video/mp4',
      cacheControl: '3600',
    });
    expect(Object.keys(create.headers).map((name) => name.toLowerCase())).not.toContain('x-upsert');
    expect(video.saveUploadUrl).toHaveBeenCalledWith(UPLOAD_URL);
  });

  test('carries a name outside ASCII in its metadata as UTF-8', async () => {
    const named = 'хост/úklid-č.1/видео.mp4';

    await tusUpload(upload({ objectName: named }), runtime());

    expect(decodeMetadata(storage.calls[0].headers['Upload-Metadata']).objectName).toBe(named);
  });

  test('goes in pieces of exactly 6 MB, the last one shorter, each at its offset', async () => {
    await tusUpload(upload(), runtime());

    expect(TUS_CHUNK_BYTES).toBe(6 * 1024 * 1024);
    expect(storage.patches()).toEqual([
      { offset: 0, length: TUS_CHUNK_BYTES },
      { offset: TUS_CHUNK_BYTES, length: TUS_CHUNK_BYTES },
      { offset: 2 * TUS_CHUNK_BYTES, length: 1000 },
    ]);
    const patch = storage.calls.find((call) => call.method === 'PATCH');
    expect(patch?.url).toBe(UPLOAD_URL);
    expect(patch?.headers).toMatchObject({
      'Tus-Resumable': '1.0.0',
      'Content-Type': 'application/offset+octet-stream',
      apikey: 'test-publishable-key',
    });
    expect(storage.offset).toBe(SIZE);
  });

  test('reads the file a piece at a time, never whole, and closes it', async () => {
    await tusUpload(upload(), runtime());

    expect(file.reads).toEqual([
      [0, TUS_CHUNK_BYTES],
      [TUS_CHUNK_BYTES, TUS_CHUNK_BYTES],
      [2 * TUS_CHUNK_BYTES, 1000],
    ]);
    expect(file.isClosed()).toBe(true);
  });

  test('asks for the session’s token before every request, so a long upload outlives it', async () => {
    const video = upload();

    await tusUpload(video, runtime());

    expect(video.accessToken).toHaveBeenCalledTimes(storage.calls.length);
    expect(video.accessToken).not.toHaveBeenCalledWith(true);
    expect(storage.calls.map((call) => call.headers.Authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
      'Bearer token-3',
      'Bearer token-4',
    ]);
  });

  test('says how far it has got as the pieces arrive', async () => {
    const video = upload();

    await tusUpload(video, runtime());

    expect(video.onProgress.mock.calls).toEqual([
      [0, SIZE],
      [TUS_CHUNK_BYTES, SIZE],
      [2 * TUS_CHUNK_BYTES, SIZE],
      [SIZE, SIZE],
    ]);
  });

  test('a Location given as a path is read against the endpoint', async () => {
    storage.plan('POST', (self) => {
      self.offset = 0;
      return { status: 201, headers: { Location: '/storage/v1/upload/resumable/relative-1' } };
    });

    await tusUpload(upload(), runtime());

    expect(storage.patches()).toHaveLength(3);
    expect(storage.calls[1].url).toBe(`${ENDPOINT}/relative-1`);
  });
});

// The address is where every piece of the video goes, with her token on it:
// only the project's own storage, and only over TLS.
describe('the address of an upload', () => {
  test.each([
    ['on another host', 'https://elsewhere.example/storage/v1/upload/resumable/upload-1'],
    ['without TLS', 'http://project.supabase.co/storage/v1/upload/resumable/upload-1'],
  ])('%s is refused, and nothing is sent there', async (_name, location) => {
    storage.plan('POST', { status: 201, headers: { Location: location } });
    const video = upload();

    await expect(tusUpload(video, runtime())).rejects.toBeInstanceOf(TusRefusedError);

    expect(storage.methods()).toEqual(['POST']);
    expect(video.saveUploadUrl).not.toHaveBeenCalled();
  });

  test('missing is a refusal that names the answer it came with', async () => {
    storage.plan('POST', { status: 201 });

    const failure = tusUpload(upload(), runtime());

    await expect(failure).rejects.toBeInstanceOf(TusRefusedError);
    await expect(failure).rejects.toMatchObject({ status: 201 });
  });

  test.each([
    ['on another host', 'https://elsewhere.example/upload-1', /elsewhere\.example/],
    ['without TLS', 'http://project.supabase.co/upload-1', /https/],
    ['of another project’s storage', 'https://other.storage.supabase.co/upload-1', /other\./],
  ])('%s says so in the refusal', async (_name, location, words) => {
    storage.plan('POST', { status: 201, headers: { Location: location } });

    await expect(tusUpload(upload(), runtime())).rejects.toThrow(words);
  });

  test('missing says so in the refusal', async () => {
    storage.plan('POST', { status: 201 });

    await expect(tusUpload(upload(), runtime())).rejects.toThrow(/without a Location/);
  });

  // Supabase answers from the project's own storage host, which carries the
  // same project reference under `storage.`.
  test('on the project’s own storage host is taken', async () => {
    const onStorageHost = 'https://project.storage.supabase.co/storage/v1/upload/resumable/s-1';
    storage.plan('POST', (self) => {
      self.offset = 0;
      return { status: 201, headers: { Location: onStorageHost } };
    });

    await tusUpload(upload(), runtime());

    expect(storage.patches()).toHaveLength(3);
    expect(storage.calls[1].url).toBe(onStorageHost);
  });

  test('kept from before on the project’s storage host is asked about, not forgotten', async () => {
    storage.offset = TUS_CHUNK_BYTES;
    const kept = 'https://project.storage.supabase.co/storage/v1/upload/resumable/s-1';
    const video = upload({ uploadUrl: kept });

    await tusUpload(video, runtime());

    expect(storage.calls[0]).toMatchObject({ method: 'HEAD', url: kept });
    expect(video.saveUploadUrl).not.toHaveBeenCalled();
  });

  // The local stack on the machine, and the Android emulator's way to it.
  test.each(['http://localhost:54321', 'http://127.0.0.1:54321', 'http://10.0.2.2:54321'])(
    'of a local stack at %s may go without TLS',
    async (base) => {
      const endpoint = `${base}/storage/v1/upload/resumable`;
      storage.plan('POST', (self) => {
        self.offset = 0;
        return { status: 201, headers: { Location: `${endpoint}/local-1` } };
      });

      await tusUpload(upload({ endpoint }), runtime());

      expect(storage.calls.map((call) => call.url)).toEqual([
        endpoint,
        `${endpoint}/local-1`,
        `${endpoint}/local-1`,
        `${endpoint}/local-1`,
      ]);
    },
  );

  test('of a local stack is still refused on another port', async () => {
    const endpoint = 'http://localhost:54321/storage/v1/upload/resumable';
    storage.plan('POST', {
      status: 201,
      headers: { Location: 'http://localhost:9999/storage/v1/upload/resumable/local-1' },
    });

    await expect(tusUpload(upload({ endpoint }), runtime())).rejects.toBeInstanceOf(
      TusRefusedError,
    );
    expect(storage.methods()).toEqual(['POST']);
  });

  test('an endpoint without TLS away from a local stack is refused before anything is sent', async () => {
    const endpoint = 'http://project.supabase.co/storage/v1/upload/resumable';

    await expect(tusUpload(upload({ endpoint }), runtime())).rejects.toThrow(/https/);

    expect(storage.calls).toEqual([]);
  });

  test('kept from before on another host is forgotten, and a new upload made', async () => {
    const video = upload({ uploadUrl: 'https://elsewhere.example/upload-1' });

    await tusUpload(video, runtime());

    expect(storage.methods()).toEqual(['POST', 'PATCH', 'PATCH', 'PATCH']);
    expect(jest.mocked(video.saveUploadUrl).mock.calls).toEqual([[null], [UPLOAD_URL]]);
  });
});

describe('the file on the phone', () => {
  // The phone's copy is deleted once the server confirms: what goes up must
  // be what was registered, or the loss is for good.
  test.each([
    ['a size other than the one registered', SIZE - 1],
    ['nothing at all', 0],
  ])('of %s is not uploaded, and kept', async (_name, size) => {
    const other = videoFile(size);

    await expect(
      tusUpload(upload({ openSource: async () => other.source }), runtime()),
    ).rejects.toBeInstanceOf(TusFileError);

    expect(storage.calls).toEqual([]);
    expect(other.isClosed()).toBe(true);
  });

  test('that reads short fails the attempt rather than sending less', async () => {
    const short: TusSource = {
      size: SIZE,
      read: async (_offset, length) => new Uint8Array(length - 1),
      close: jest.fn(),
    };

    await expect(
      tusUpload(upload({ openSource: async () => short }), runtime()),
    ).rejects.toBeInstanceOf(TusFileError);

    expect(storage.patches()).toEqual([]);
    expect(short.close).toHaveBeenCalled();
  });
});

test('a file that cannot be read fails the attempt and is closed', async () => {
  const broken: TusSource = {
    size: SIZE,
    read: async () => {
      throw new Error('File is not readable');
    },
    close: jest.fn(),
  };

  await expect(tusUpload(upload({ openSource: async () => broken }), runtime())).rejects.toThrow(
    'File is not readable',
  );

  expect(broken.close).toHaveBeenCalled();
});
