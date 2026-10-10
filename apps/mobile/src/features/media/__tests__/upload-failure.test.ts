import { RefusalError } from '@/lib/server-error';

import { UploadTooSlowError } from '../attach-retry';
import { TusFileError, TusRefusedError, TusRetryableError } from '../tus';
import { uploadFailureOf } from '../upload-failure';

/**
 * Why a file did not get in, as its tile says it in a few words: the code the
 * storage answered with, or the kind of failure (night of 2026-10-10, block 1:
 * a 105.9 MB video the owner recorded was turned down and its tile said only
 * «Не загрузилось»).
 */
describe('uploadFailureOf', () => {
  test.each([
    [
      'the storage turned a file down as too large',
      new TusRefusedError(413, 'POST answered 413'),
      { key: 'tooLarge' },
    ],
    [
      'the storage refused for another reason',
      new TusRefusedError(403, 'POST answered 403'),
      { key: 'refused', status: 403 },
    ],
    [
      'an endpoint refused before anything was sent',
      new TusRefusedError(0, 'endpoint not https'),
      { key: 'other', type: 'TusRefusedError' },
    ],
    ['no answer at all', new TusRetryableError('cut', 'no-answer'), { key: 'noNetwork' }],
    ['no answer in time', new TusRetryableError('timed out', 'timed-out'), { key: 'timedOut' }],
    [
      'the storage busy',
      new TusRetryableError('503', 'busy', { status: 503 }),
      { key: 'busy', status: 503 },
    ],
    [
      'the storage kept losing its place',
      new TusRetryableError('lost', 'lost-place'),
      { key: 'lostPlace' },
    ],
    [
      'a piece that moved nothing',
      new TusRetryableError('stalled', 'stalled', { offset: 0 }),
      { key: 'tooSlow' },
    ],
    ['the stalls spent', new UploadTooSlowError(new Error('stalled')), { key: 'tooSlow' }],
    [
      'the file on the phone is not the one registered',
      new TusFileError('short read'),
      { key: 'fileUnreadable' },
    ],
    [
      'the server refused the row in its own key',
      new RefusalError('refused', 'serverErrors.mediaKind'),
      { key: 'server' },
    ],
    [
      'a photo the storage found too large',
      Object.assign(new Error('Payload too large'), { statusCode: '413' }),
      { key: 'tooLarge' },
    ],
    [
      'a photo the storage refused',
      Object.assign(new Error('new row violates policy'), { statusCode: '403' }),
      { key: 'refused', status: 403 },
    ],
    [
      'a database error with its code',
      { code: 'P0001', message: 'refused', hint: 'serverErrors.mediaKind' },
      { key: 'server' },
    ],
    ['a fetch that reached nothing', new TypeError('Network request failed'), { key: 'noNetwork' }],
    [
      'anything else, by its kind',
      new RangeError('Invalid array length'),
      { key: 'other', type: 'RangeError' },
    ],
  ])('%s', (_label, error, expected) => {
    expect(uploadFailureOf(error)).toEqual(expected);
  });

  test('a file stranded with no failure known — the app was closed under it — was interrupted', () => {
    expect(uploadFailureOf(undefined)).toEqual({ key: 'interrupted' });
  });

  test('a thrown value that is not an error is named by its type, not shown', () => {
    expect(uploadFailureOf('boom')).toEqual({ key: 'other', type: 'string' });
  });
});
