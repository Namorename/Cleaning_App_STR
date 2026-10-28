import { serverErrorText } from '@/lib/server-error';

import { assertStorageTakes, STORAGE_FILE_LIMIT_MB, TooLargeForStorageError } from '../storage-limit';

/**
 * The storage's one-upload limit (Supabase Free: 50 MB of 10^6 bytes), said
 * before a file is queued rather than by a 413 after the person has left.
 */
describe('assertStorageTakes', () => {
  test('a file right at the limit goes', () => {
    expect(() => assertStorageTakes(STORAGE_FILE_LIMIT_MB * 1_000_000)).not.toThrow();
  });

  test('one byte over is refused with the size rounded up and the limit', () => {
    let refusal: unknown = null;
    try {
      assertStorageTakes(50_000_001);
    } catch (error: unknown) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(TooLargeForStorageError);
    expect((refusal as TooLargeForStorageError).key).toBe('video.tooLargeForStorage');
    expect(JSON.parse((refusal as TooLargeForStorageError).details)).toEqual({
      size: 51,
      limit: 50,
    });
  });

  test('the refusal reads in her language, with no raw message under it', () => {
    let refusal: unknown = null;
    try {
      assertStorageTakes(105_900_000);
    } catch (error: unknown) {
      refusal = error;
    }

    expect(serverErrorText(refusal)).toEqual({
      text: 'Видео весит 106 МБ, а хранилище принимает файлы не больше 50 МБ. Нажмите «Переснять» и запишите видео короче.',
      detail: null,
    });
  });
});
