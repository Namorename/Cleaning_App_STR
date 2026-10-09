import { MediaLibraryDeniedError, exifTakenAt } from '../capture';
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

// A video never comes from the gallery (docs/tech-plan.md §7.1): the server
// refuses one (`videoCameraOnly`), so there is no picker for it to test.

describe('telling the cleaner why nothing was attached', () => {
  const t = ((key: string, params?: Record<string, unknown>) =>
    params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never;

  test('each refusal has its own words', () => {
    expect(attachFailure(new MediaLibraryDeniedError('no'), t)).toBe('steps.galleryDenied');
  });

  test('and anything else falls back to the general one', () => {
    expect(attachFailure(new Error('disk full'), t)).toBe('steps.captureFailed');
  });
});
