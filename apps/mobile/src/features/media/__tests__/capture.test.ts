import {
  BASELINE_JPEG_BASE64,
  dirtyJpeg,
  fromBase64,
  metadataLeaks,
} from '../../../../../../packages/shared/src/testing/image-fixtures';
import { capturePhoto, EmptyCaptureError, keepRecording, pickVideoFromGallery } from '../capture';
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
  // What a file holds, for the tests that read it; the others know only sizes.
  const contents: Map<string, Uint8Array> = new Map();

  class MockFile {
    readonly uri: string;

    constructor(base: string | { uri: string }, name?: string) {
      this.uri = typeof base === 'string' ? base : `${base.uri}${name ?? ''}`;
    }

    get exists(): boolean {
      return sizes.has(this.uri);
    }

    // As the native one: 0 for a file that is not there, never null.
    get size(): number {
      return sizes.get(this.uri) ?? 0;
    }

    async bytes(): Promise<Uint8Array> {
      return contents.get(this.uri) ?? new Uint8Array(sizes.get(this.uri) ?? 0);
    }

    write(content: Uint8Array): void {
      contents.set(this.uri, content);
      sizes.set(this.uri, content.length);
    }

    async move(destination: MockFile): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const size = sizes.get(this.uri);
      if (size === undefined) {
        throw new Error(`nothing to move at ${this.uri}`);
      }
      sizes.delete(this.uri);
      sizes.set(destination.uri, size);
      const content = contents.get(this.uri);
      if (content !== undefined) {
        contents.delete(this.uri);
        contents.set(destination.uri, content);
      }
    }

    delete(): void {
      sizes.delete(this.uri);
      contents.delete(this.uri);
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
    __contents: contents,
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

/** The mock's own maps, so a test can put a file on this filesystem. */
const { __sizes: sizes, __contents: contents } = jest.requireMock('expo-file-system') as {
  __sizes: Map<string, number>;
  __contents: Map<string, Uint8Array>;
};

beforeEach(() => {
  sizes.clear();
  contents.clear();
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

/**
 * Where, when and on which phone: none of it leaves with the photo (owner's
 * word, 2026-09-28). The manipulator re-encodes every photo from a bare
 * bitmap, which already drops it — this guard is there for the day a
 * manipulator version or a phone's encoder writes some of it back.
 */
test('a photo is uploaded without what the camera wrote about place, time and phone', async () => {
  // Arrange: the manipulator's output, as if it had kept the camera's Exif.
  const dirty = dirtyJpeg(fromBase64(BASELINE_JPEG_BASE64));
  contents.set('file:///cache/compressed.jpg', dirty);
  sizes.set('file:///cache/compressed.jpg', dirty.length);

  // Act
  const photo = await capturePhoto();

  // Assert: the kept file is the clean one, and it is declared at its own size.
  const kept = contents.get('file:///documents/task-media/kept-id.jpg');
  expect(kept).toBeDefined();
  expect(metadataLeaks(kept as Uint8Array)).toEqual([]);
  expect(photo?.byteSize).toBe((kept as Uint8Array).length);
  expect(photo?.byteSize).toBeLessThan(dirty.length);
});

test('a photo with nothing to remove is not written again', async () => {
  const clean = fromBase64(BASELINE_JPEG_BASE64);
  contents.set('file:///cache/compressed.jpg', clean);
  sizes.set('file:///cache/compressed.jpg', clean.length);

  const photo = await capturePhoto();

  expect(contents.get('file:///documents/task-media/kept-id.jpg')).toBe(clean);
  expect(photo?.byteSize).toBe(clean.length);
});

/**
 * A video comes from the app's own recording screen, not from the picker: the
 * camera reports only where it wrote the file. The length is what the screen
 * timed, the container is the file's own, and it is declared as the camera's;
 * a video picked from the gallery is declared as the gallery's (below).
 */
describe('a recording from the app’s own camera', () => {
  const takenAt = '2026-10-09T08:00:00.000Z';

  test('is kept under an id of ours, measured where it landed, with the length the screen timed', async () => {
    sizes.set('file:///cache/Camera/recording.mp4', 31_900_000);

    const video = await keepRecording({
      uri: 'file:///cache/Camera/recording.mp4',
      durationSec: 87.4,
      takenAt,
    });

    expect(video).toEqual({
      id: 'kept-id',
      kind: 'video',
      uri: 'file:///documents/task-media/kept-id.mp4',
      mimeType: 'video/mp4',
      byteSize: 31_900_000,
      width: null,
      height: null,
      durationSec: 87.4,
      takenAt,
      source: 'camera',
    });
  });

  test('an iPhone’s QuickTime file keeps its container', async () => {
    sizes.set('file:///cache/Camera/recording.mov', 30_000_000);

    const video = await keepRecording({
      uri: 'file:///cache/Camera/recording.mov',
      durationSec: 12,
      takenAt,
    });

    expect(video.mimeType).toBe('video/quicktime');
    expect(video.uri).toBe('file:///documents/task-media/kept-id.mov');
  });

  test('one that measures nothing is refused here, not by the server', async () => {
    sizes.set('file:///cache/Camera/recording.mp4', 0);

    await expect(
      keepRecording({ uri: 'file:///cache/Camera/recording.mp4', durationSec: 3, takenAt }),
    ).rejects.toBeInstanceOf(EmptyCaptureError);
  });

  // Nothing to send and nothing to try again with: the empty file it was
  // moved into is not left behind in the app's documents.
  test('one that measures nothing leaves no kept file behind', async () => {
    sizes.set('file:///cache/Camera/recording.mp4', 0);

    await keepRecording({
      uri: 'file:///cache/Camera/recording.mp4',
      durationSec: 3,
      takenAt,
    }).catch(() => undefined);

    expect(sizes.has('file:///documents/task-media/kept-id.mp4')).toBe(false);
  });
});

// Night of 2026-10-10, block 6: a video chosen from the gallery, where the
// company allows the gallery. The picker hands over a copy in the app's cache;
// it is kept like a recording, and says it came from the gallery.
describe('a video from the gallery', () => {
  const picker = jest.requireMock('expo-image-picker') as { launchImageLibraryAsync: jest.Mock };

  test('asks the gallery for videos only, and reads what the file says of itself', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///cache/ImagePicker/clip.mp4',
          duration: 20_500,
          fileSize: 12_000_000,
          mimeType: 'video/mp4',
        },
      ],
    });

    const picked = await pickVideoFromGallery();

    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['videos'] }),
    );
    expect(picked).toEqual({
      uri: 'file:///cache/ImagePicker/clip.mp4',
      durationSec: 20.5,
      byteSize: 12_000_000,
      mimeType: 'video/mp4',
      takenAt: expect.any(String),
    });
  });

  test('a file that does not say its size or type is measured and named by its container', async () => {
    sizes.set('file:///cache/ImagePicker/clip.mov', 9_000_000);
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/ImagePicker/clip.mov', duration: 4_000 }],
    });

    const picked = await pickVideoFromGallery();

    expect(picked).toMatchObject({ byteSize: 9_000_000, mimeType: 'video/quicktime' });
  });

  test('backing out of the gallery is nothing chosen, not a failure', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: null });

    await expect(pickVideoFromGallery()).resolves.toBeNull();
  });

  test('is kept under an id of ours, in its own container, declared as from the gallery', async () => {
    sizes.set('file:///cache/ImagePicker/clip.mov', 30_000_000);

    const video = await keepRecording(
      {
        uri: 'file:///cache/ImagePicker/clip.mov',
        durationSec: 12,
        takenAt: '2026-10-10T08:00:00.000Z',
      },
      'gallery',
      'video/quicktime',
    );

    expect(video).toMatchObject({
      uri: 'file:///documents/task-media/kept-id.mov',
      mimeType: 'video/quicktime',
      byteSize: 30_000_000,
      source: 'gallery',
    });
  });
});
