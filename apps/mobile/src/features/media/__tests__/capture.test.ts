import { capturePhoto, EmptyCaptureError } from '../capture';
import { attachFailure } from '../failure';
import { fileSize, keepFile } from '../file';

/**
 * A capture is measured where it landed, not where it was sent.
 *
 * `File.move()` is a promise in expo-file-system 56 and later, and the version
 * that ignored it read the size of a path the file had not reached yet. On
 * Android the native move runs on a coroutine, so it was a race the JS thread
 * usually won: size 0, the server refusing the row, and the cleaner reading
 * "this file type is not accepted" about a photo her own camera had just
 * taken. Some frames did go through, which is what a race looks like from the
 * outside and why it survived the office.
 *
 * The stock jest mock of expo-file-system cannot show any of this — its
 * `move()` calls `moveSync()` in its own body, so the file is always there by
 * the time anyone looks. This suite brings its own filesystem, where a move
 * lands a tick later, the way the real one does.
 */

jest.mock('expo-file-system', () => {
  const sizes: Map<string, number> = new Map();

  class MockFile {
    readonly uri: string;

    constructor(base: string | { uri: string }, name?: string) {
      this.uri = typeof base === 'string' ? base : `${base.uri}${name ?? ''}`;
    }

    get exists(): boolean {
      return sizes.has(this.uri);
    }

    get size(): number | null {
      return sizes.get(this.uri) ?? null;
    }

    async move(destination: MockFile): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const size = sizes.get(this.uri);
      if (size === undefined) {
        throw new Error(`nothing to move at ${this.uri}`);
      }
      sizes.delete(this.uri);
      sizes.set(destination.uri, size);
    }

    delete(): void {
      sizes.delete(this.uri);
    }
  }

  class MockDirectory {
    readonly uri: string;
    readonly exists = true;

    constructor(base: string, name: string) {
      this.uri = `${base}${name}/`;
    }

    create(): void {
      // Always there in this filesystem.
    }
  }

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: 'file:///documents/' },
    __sizes: sizes,
  };
});

jest.mock('expo-crypto', () => ({ randomUUID: () => 'kept-id' }));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async () => ({
    uri: 'file:///cache/compressed.jpg',
    width: 1600,
    height: 1200,
  })),
}));

jest.mock('expo-image-picker', () => ({
  getCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///cache/shot.jpg', width: 3000, height: 2250, exif: null }],
  })),
  launchImageLibraryAsync: jest.fn(),
  UIImagePickerControllerQualityType: { IFrame1280x720: 1 },
  MediaTypeOptions: { Images: 'Images', Videos: 'Videos' },
}));

/** The mock's own map, so a test can put a file on this filesystem. */
const sizes = (jest.requireMock('expo-file-system') as { __sizes: Map<string, number> }).__sizes;

beforeEach(() => {
  sizes.clear();
});

test('a kept file is measured after it has arrived, not while it is moving', async () => {
  sizes.set('file:///cache/photo.jpg', 4096);

  const kept = await keepFile('file:///cache/photo.jpg', 'kept-id', 'jpg');

  expect(kept).toBe('file:///documents/task-media/kept-id.jpg');
  expect(await fileSize(kept)).toBe(4096);
});

test('the source is gone once the move has finished', async () => {
  sizes.set('file:///cache/photo.jpg', 4096);

  await keepFile('file:///cache/photo.jpg', 'kept-id', 'jpg');

  expect(await fileSize('file:///cache/photo.jpg')).toBe(0);
});

test('a photo carries the size it really has', async () => {
  sizes.set('file:///cache/compressed.jpg', 250_000);

  const photo = await capturePhoto();

  expect(photo?.byteSize).toBe(250_000);
  expect(photo?.uri).toBe('file:///documents/task-media/kept-id.jpg');
  expect(photo?.mimeType).toBe('image/jpeg');
});

test('a photo that measures nothing is refused here, not by the server', async () => {
  // Nothing is put on the filesystem: the move finds no file, which is the
  // shape an interrupted capture has. The point is that the phone stops —
  // registering a zero-byte row only earns a refusal worded about file types.
  await expect(capturePhoto()).rejects.toThrow();
});

test('an empty capture reads as a capture failure, not as a rejected file type', () => {
  const t = ((key: string) => key) as unknown as Parameters<typeof attachFailure>[1];

  expect(attachFailure(new EmptyCaptureError('file:///documents/task-media/kept-id.jpg'), t)).toBe(
    'steps.captureFailed',
  );
});

test('a photo taken here declares the camera, which is what lets the gallery open at all', async () => {
  sizes.set('file:///cache/compressed.jpg', 250_000);

  const photo = await capturePhoto();

  // The declaration is made where it is still known: by the time the row is
  // written, a picked file and a taken one look exactly alike.
  expect(photo?.source).toBe('camera');
});
