import * as ImagePicker from 'expo-image-picker';

import {
  MediaLibraryDeniedError,
  VideoTooLongError,
  exifTakenAt,
  pickVideoFromGallery,
} from '../capture';
import { attachFailure } from '../failure';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'generated-id' }));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(),
}));
jest.mock('../file', () => ({
  keepFile: (uri: string) => uri,
  fileSize: async () => 1024,
}));
jest.mock('expo-image-picker', () => ({
  getMediaLibraryPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  getCameraPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  UIImagePickerControllerQualityType: { IFrame1280x720: 1 },
}));

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

const videoAsset = (durationMs: number | null) => ({
  uri: 'file:///gallery/clip.mp4',
  width: 1280,
  height: 720,
  mimeType: 'video/mp4',
  duration: durationMs,
  exif: null,
});

function allowLibrary() {
  picker.getMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('when a photograph says it was taken', () => {
  test('EXIF colons and all, it is read', () => {
    expect(exifTakenAt({ DateTimeOriginal: '2026:09:03 14:20:05' })).toBe(
      new Date(2026, 8, 3, 14, 20, 5).toISOString(),
    );
  });

  test('DateTime serves when DateTimeOriginal is missing', () => {
    expect(exifTakenAt({ DateTime: '2026:01:31 08:00:00' })).toBe(
      new Date(2026, 0, 31, 8, 0, 0).toISOString(),
    );
  });

  test('and a file with nothing to say answers nothing', () => {
    expect(exifTakenAt(null)).toBeNull();
    expect(exifTakenAt({})).toBeNull();
    expect(exifTakenAt({ DateTimeOriginal: 'sometime last week' })).toBeNull();
    expect(exifTakenAt({ DateTimeOriginal: 42 })).toBeNull();
  });
});

describe('choosing a video from the gallery', () => {
  test('a recording longer than the step allows is refused before anything is copied', async () => {
    allowLibrary();
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [videoAsset(45_000)],
    } as never);

    await expect(pickVideoFromGallery(30)).rejects.toBeInstanceOf(VideoTooLongError);
  });

  test('one within the limit goes through', async () => {
    allowLibrary();
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [videoAsset(12_000)],
    } as never);

    const picked = await pickVideoFromGallery(30);

    expect(picked?.durationSec).toBe(12);
    expect(picked?.kind).toBe('video');
  });

  // Refusing on a measurement that does not exist would strand her with no
  // way past; the server bounds the size regardless.
  test('and one the picker could not measure is let through', async () => {
    allowLibrary();
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [videoAsset(null)],
    } as never);

    const picked = await pickVideoFromGallery(30);

    expect(picked?.durationSec).toBe(30);
  });

  test('backing out of the picker is not a failure', async () => {
    allowLibrary();
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true } as never);

    await expect(pickVideoFromGallery(30)).resolves.toBeNull();
  });

  test('a refused permission says which permission it was', async () => {
    picker.getMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false } as never);
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false } as never);

    await expect(pickVideoFromGallery(30)).rejects.toBeInstanceOf(MediaLibraryDeniedError);
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });
});

describe('telling the cleaner why nothing was attached', () => {
  const t = ((key: string, params?: Record<string, unknown>) =>
    params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never;

  test('each refusal has its own words', () => {
    expect(attachFailure(new MediaLibraryDeniedError('no'), t)).toBe('steps.galleryDenied');
    expect(attachFailure(new VideoTooLongError(30), t)).toBe('steps.videoTooLong:{"seconds":30}');
  });

  test('and anything else falls back to the general one', () => {
    expect(attachFailure(new Error('disk full'), t)).toBe('steps.captureFailed');
  });
});
