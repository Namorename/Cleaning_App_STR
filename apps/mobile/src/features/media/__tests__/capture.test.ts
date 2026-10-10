import {
  BASELINE_JPEG_BASE64,
  dirtyJpeg,
  fromBase64,
  metadataLeaks,
} from '../../../../../../packages/shared/src/testing/image-fixtures';
import { Platform } from 'react-native';

import {
  capturePhoto,
  EmptyCaptureError,
  keepRecording,
  MediaLibraryDeniedError,
  pickVideoFromGallery,
} from '../capture';
import { attachFailure } from '../failure';
import { discardFile, fileSize, keepFile, readFileBytes } from '../file';

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

    async arrayBuffer(): Promise<ArrayBuffer> {
      return (await this.bytes()).slice().buffer;
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

  // A folder that cannot be read, for the tests that say so.
  const unreadable = { isOn: false };

  class MockDirectory {
    readonly uri: string;
    readonly exists = true;

    constructor(base: string, name: string) {
      this.uri = `${base}${name}/`;
    }

    create(): void {
      // Always there in this filesystem.
    }

    /** The files right in this folder, as the native listing gives them. */
    list(): MockFile[] {
      if (unreadable.isOn) {
        throw new Error(`cannot list ${this.uri}`);
      }
      return [...sizes.keys()]
        .filter((uri) => uri.startsWith(this.uri) && !uri.slice(this.uri.length).includes('/'))
        .map((uri) => new MockFile(uri));
    }
  }

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: 'file:///documents/', cache: 'file:///cache/' },
    __sizes: sizes,
    __contents: contents,
    __unreadable: unreadable,
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
  VideoExportPreset: { Passthrough: 0, H264_1280x720: 6 },
}));

/** The mock's own maps, so a test can put a file on this filesystem. */
const {
  __sizes: sizes,
  __contents: contents,
  __unreadable: unreadable,
} = jest.requireMock('expo-file-system') as {
  __sizes: Map<string, number>;
  __contents: Map<string, Uint8Array>;
  __unreadable: { isOn: boolean };
};

beforeEach(() => {
  sizes.clear();
  contents.clear();
});

test('a kept file is measured after it has arrived, not while it is moving', async () => {
  sizes.set('file:///cache/photo.jpg', 4096);

  const kept = await keepFile('file:///cache/photo.jpg', 'kept-id', 'jpg');

  // Remembered by its place in the documents, not by the install's full path
  // (iPhone risk 1): the size is read from the documents of this run.
  expect(kept).toBe('task-media/kept-id.jpg');
  expect(await fileSize(kept)).toBe(4096);
});

/**
 * A kept file named the way a build before this one remembered it — the full
 * path, inside the folder of the install it ran in. A new build on an iPhone
 * may run in another folder; the file moved with the documents, so it is
 * looked for there (docs/ios-first-device-checklist.md, risk 1).
 */
describe('a kept file remembered by an older build', () => {
  const OLD_PATH =
    'file:///var/mobile/Containers/Data/Application/OLD-UUID/Documents/task-media/kept-id.jpg';

  beforeEach(() => {
    sizes.set('file:///documents/task-media/kept-id.jpg', 4096);
  });

  test('is measured where it is now', async () => {
    await expect(fileSize(OLD_PATH)).resolves.toBe(4096);
  });

  test('is read for its upload where it is now', async () => {
    const body = await readFileBytes(OLD_PATH);

    expect((body as ArrayBuffer).byteLength).toBe(4096);
  });

  test('is removed where it is now, as is one remembered by its place', () => {
    discardFile(OLD_PATH);
    expect(sizes.has('file:///documents/task-media/kept-id.jpg')).toBe(false);

    sizes.set('file:///documents/task-media/kept-id.jpg', 4096);
    discardFile('task-media/kept-id.jpg');
    expect(sizes.has('file:///documents/task-media/kept-id.jpg')).toBe(false);
  });
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
  expect(photo?.uri).toBe('task-media/kept-id.jpg');
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
      uri: 'task-media/kept-id.mp4',
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
    expect(video.uri).toBe('task-media/kept-id.mov');
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

  const library = jest.requireMock('expo-image-picker') as {
    getMediaLibraryPermissionsAsync: jest.Mock;
    requestMediaLibraryPermissionsAsync: jest.Mock;
  };

  let os: jest.ReplaceProperty<typeof Platform.OS> | undefined;
  const runOn = (platform: typeof Platform.OS) => {
    os = jest.replaceProperty(Platform, 'OS', platform);
  };

  afterEach(() => {
    os?.restore();
    os = undefined;
    picker.launchImageLibraryAsync.mockReset();
  });

  /**
   * An iPhone's camera films 4K HEVC: a minute from the roll is far past the
   * storage's 50 MB (docs/ios-first-device-checklist.md, risk 3). The iPhone's
   * picker compresses it to 720p H.264 as it hands it over; the checks of the
   * step still hold what comes out (gallery-video.ts).
   */
  test('on an iPhone, asks for the video compressed to 720p H.264, and says it was', async () => {
    runOn('ios');
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///cache/ImagePicker/clip.mp4',
          duration: 20_000,
          fileSize: 9_000_000,
          mimeType: 'video/mp4',
        },
      ],
    });

    const picked = await pickVideoFromGallery();

    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['videos'], videoExportPreset: 6 }),
    );
    expect(picked).toMatchObject({
      byteSize: 9_000_000,
      mimeType: 'video/mp4',
      isCompressed: true,
    });
  });

  test('on Android, asks the gallery as before: no preset, the file as it is', async () => {
    runOn('android');
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'content://media/clip.mp4',
          duration: 20_000,
          fileSize: 9_000_000,
          mimeType: 'video/mp4',
        },
      ],
    });

    const picked = await pickVideoFromGallery();

    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ['videos'],
      quality: 1,
    });
    expect(picked).toMatchObject({ uri: 'content://media/clip.mp4', isCompressed: false });
  });

  test('asks for the photos before the gallery opens', async () => {
    const asked: string[] = [];
    library.getMediaLibraryPermissionsAsync.mockImplementationOnce(async () => {
      asked.push('current');
      return { granted: false };
    });
    library.requestMediaLibraryPermissionsAsync.mockImplementationOnce(async () => {
      asked.push('request');
      return { granted: true };
    });
    picker.launchImageLibraryAsync.mockImplementationOnce(async () => {
      asked.push('gallery');
      return { canceled: true, assets: null };
    });

    await pickVideoFromGallery();

    expect(asked).toEqual(['current', 'request', 'gallery']);
  });

  test('photos not allowed: the gallery does not open, and the screen is told why', async () => {
    library.getMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false });
    library.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false });

    await expect(pickVideoFromGallery()).rejects.toBeInstanceOf(MediaLibraryDeniedError);
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  test('asks the gallery for videos only, and reads what the file says of itself', async () => {
    runOn('ios');
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
      isCompressed: true,
      pickerCopies: [],
    });
  });

  /**
   * An iPhone's picker copies the chosen video into its own folder of the
   * cache before it compresses it, and hands over the compressed file only:
   * the copy, the size of the original, stays there choice after choice
   * (review of a065d08). It is named here — a video that appeared in the
   * picker's folder during this choice, other than the file handed over — for
   * the screen to let go of once the video is kept (owner's word of
   * 2026-10-10, 23:45). The cache is never swept.
   */
  describe('the picker’s own copy of the choice', () => {
    const FOLDER = 'file:///cache/ImagePicker/';

    afterEach(() => {
      unreadable.isOn = false;
    });

    function handsOver(file: string, made: readonly string[]) {
      return async () => {
        made.forEach((uri) => sizes.set(uri, 1_000));
        return {
          canceled: false,
          assets: [{ uri: file, duration: 20_000, fileSize: 30_000_000, mimeType: 'video/mp4' }],
        };
      };
    }

    test('is the video that appeared beside the one handed over, and only it', async () => {
      runOn('ios');
      sizes.set(`${FOLDER}earlier.MOV`, 900);
      sizes.set(`${FOLDER}earlier.jpg`, 10);
      picker.launchImageLibraryAsync.mockImplementationOnce(
        handsOver(`${FOLDER}compressed.mp4`, [
          `${FOLDER}original.MOV`,
          `${FOLDER}compressed.mp4`,
          `${FOLDER}a-photo.jpg`,
        ]),
      );

      const picked = await pickVideoFromGallery();

      expect(picked?.pickerCopies).toEqual([`${FOLDER}original.MOV`]);
    });

    test('nothing is deleted while she chooses', async () => {
      runOn('ios');
      picker.launchImageLibraryAsync.mockImplementationOnce(
        handsOver(`${FOLDER}compressed.mp4`, [`${FOLDER}original.MOV`, `${FOLDER}compressed.mp4`]),
      );

      await pickVideoFromGallery();

      expect(sizes.has(`${FOLDER}original.MOV`)).toBe(true);
      expect(sizes.has(`${FOLDER}compressed.mp4`)).toBe(true);
    });

    test('on Android, where the picker hands over its only copy, there is none', async () => {
      runOn('android');
      picker.launchImageLibraryAsync.mockImplementationOnce(
        handsOver(`${FOLDER}clip.mp4`, [`${FOLDER}clip.mp4`]),
      );

      const picked = await pickVideoFromGallery();

      expect(picked?.pickerCopies).toEqual([]);
    });

    test('a folder that cannot be read names none, and the choice still goes', async () => {
      runOn('ios');
      unreadable.isOn = true;
      picker.launchImageLibraryAsync.mockImplementationOnce(
        handsOver(`${FOLDER}compressed.mp4`, [`${FOLDER}original.MOV`, `${FOLDER}compressed.mp4`]),
      );

      const picked = await pickVideoFromGallery();

      expect(picked).toMatchObject({ uri: `${FOLDER}compressed.mp4`, pickerCopies: [] });
    });
  });

  /**
   * An iPhone that cannot compress the chosen video (owner's word of
   * 2026-10-10, 23:45): the gallery is asked again for the original, which is
   * held to the same checks of format, length and size, and refused in the
   * same words when it is too large.
   */
  describe('a compression the iPhone cannot make', () => {
    const FOLDER = 'file:///cache/ImagePicker/';

    function failing(code: string) {
      return Object.assign(new Error('The video could not be compressed'), { code });
    }

    test.each(['ERR_FAILED_TO_TRANSCODE_VIDEO', 'ERR_UNSUPPORTED_VIDEO_EXPORT_PRESET'])(
      '%s: the gallery is asked again for the original, as it is',
      async (code) => {
        runOn('ios');
        picker.launchImageLibraryAsync.mockRejectedValueOnce(failing(code)).mockResolvedValueOnce({
          canceled: false,
          assets: [
            {
              uri: `${FOLDER}clip.MOV`,
              duration: 20_000,
              fileSize: 60_000_000,
              mimeType: 'video/quicktime',
            },
          ],
        });

        const picked = await pickVideoFromGallery();

        expect(picker.launchImageLibraryAsync).toHaveBeenCalledTimes(2);
        expect(picker.launchImageLibraryAsync).toHaveBeenLastCalledWith({
          mediaTypes: ['videos'],
          quality: 1,
        });
        expect(picked).toMatchObject({
          uri: `${FOLDER}clip.MOV`,
          byteSize: 60_000_000,
          mimeType: 'video/quicktime',
          isCompressed: false,
        });
      },
    );

    test('the copy the failed compression left is named with this choice', async () => {
      runOn('ios');
      picker.launchImageLibraryAsync
        .mockImplementationOnce(async () => {
          sizes.set(`${FOLDER}original.MOV`, 1_000);
          throw failing('ERR_FAILED_TO_TRANSCODE_VIDEO');
        })
        .mockImplementationOnce(async () => {
          sizes.set(`${FOLDER}again.MOV`, 1_000);
          return {
            canceled: false,
            assets: [{ uri: `${FOLDER}again.MOV`, duration: 20_000, fileSize: 1_000 }],
          };
        });

      const picked = await pickVideoFromGallery();

      expect(picked?.pickerCopies).toEqual([`${FOLDER}original.MOV`]);
    });

    test('any other failure of the gallery is said as it was, with no second try', async () => {
      runOn('ios');
      picker.launchImageLibraryAsync.mockRejectedValueOnce(failing('ERR_FAILED_TO_PICK_VIDEO'));

      await expect(pickVideoFromGallery()).rejects.toMatchObject({
        code: 'ERR_FAILED_TO_PICK_VIDEO',
      });
      expect(picker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
    });

    test('backing out of the second gallery is nothing chosen', async () => {
      runOn('ios');
      picker.launchImageLibraryAsync
        .mockRejectedValueOnce(failing('ERR_FAILED_TO_TRANSCODE_VIDEO'))
        .mockResolvedValueOnce({ canceled: true, assets: null });

      await expect(pickVideoFromGallery()).resolves.toBeNull();
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
      uri: 'task-media/kept-id.mov',
      mimeType: 'video/quicktime',
      byteSize: 30_000_000,
      source: 'gallery',
    });
  });
});
