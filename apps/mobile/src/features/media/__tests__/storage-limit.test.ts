import { serverErrorText } from '@/lib/server-error';

import {
  assertStorageTakes,
  STORAGE_FILE_LIMIT_MB,
  TooLargeForStorageError,
} from '../storage-limit';

/**
 * The storage's one-upload limit (150 MB of 10^6 bytes on Pro, after the
 * project's global limit; 50 on Free), said before a file is queued rather
 * than by a 413 after the person has left.
 */
describe('assertStorageTakes', () => {
  test('the limit is the bucket’s 150 MiB, counted in 10^6 bytes on the safe side', () => {
    expect(STORAGE_FILE_LIMIT_MB).toBe(150);
    expect(STORAGE_FILE_LIMIT_MB * 1_000_000).toBeLessThanOrEqual(150 * 1024 * 1024);
  });

  test('a file right at the limit goes', () => {
    expect(() => assertStorageTakes(STORAGE_FILE_LIMIT_MB * 1_000_000)).not.toThrow();
  });

  test('one byte over is refused with the size rounded up and the limit', () => {
    let refusal: unknown = null;
    try {
      assertStorageTakes(STORAGE_FILE_LIMIT_MB * 1_000_000 + 1);
    } catch (error: unknown) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(TooLargeForStorageError);
    expect((refusal as TooLargeForStorageError).key).toBe('video.tooLargeForStorage');
    expect(JSON.parse((refusal as TooLargeForStorageError).details)).toEqual({
      size: STORAGE_FILE_LIMIT_MB + 1,
      limit: STORAGE_FILE_LIMIT_MB,
    });
  });

  test('the refusal reads in her language, with no raw message under it', () => {
    let refusal: unknown = null;
    try {
      assertStorageTakes(160_400_000);
    } catch (error: unknown) {
      refusal = error;
    }

    expect(serverErrorText(refusal)).toEqual({
      text: 'Видео весит 161 МБ, а хранилище принимает файлы не больше 150 МБ. Нажмите «Переснять» и запишите видео короче.',
      detail: null,
    });
  });
});
