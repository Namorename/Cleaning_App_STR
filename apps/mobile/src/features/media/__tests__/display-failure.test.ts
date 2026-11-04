import * as Sentry from '@sentry/react-native';
import { onlineManager } from '@tanstack/react-query';

import {
  displayFailureReason,
  mediaSourceOf,
  reportMediaNotShown,
  type DisplayFailure,
} from '../display-failure';

/**
 * A photo or a video the phone could not draw, as Sentry hears of it: the
 * kind, the place, where it came from and why in a word, and the file's id.
 * The platform's own text is read for the word and never sent — on Android
 * it carries the link, and a signed link opens the file to anyone.
 */

const LINK = 'https://project.supabase.co/storage/v1/object/sign/task-media/h/t/m1.jpg?token=abc';

function failure(overrides: Partial<DisplayFailure> = {}): DisplayFailure {
  return {
    mediaId: 'm1',
    kind: 'photo',
    surface: 'strip',
    uri: LINK,
    message: `Failed to load ${LINK}, status code: 403`,
    ...overrides,
  };
}

/**
 * The run remembers what it has reported for the whole file: each test names
 * files of its own, so none finds another's already sent.
 */
let run = 0;
function freshReporter(): (overrides?: Partial<DisplayFailure>) => void {
  run += 1;
  const prefix = `run${run}-`;
  return (overrides = {}) =>
    reportMediaNotShown(failure({ ...overrides, mediaId: prefix + (overrides.mediaId ?? 'm1') }));
}

beforeEach(() => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
});

afterAll(() => {
  onlineManager.setOnline(true);
});

describe('the word for why', () => {
  test.each([
    ['HttpException: Failed to connect or obtain data, status code: 400', 'http-400'],
    ['Download marked as failed because of invalid response status code 404', 'http-404'],
    ['java.net.UnknownHostException: Unable to resolve host', 'network'],
    ['The Internet connection appears to be offline.', 'network'],
    ['The request timed out.', 'timeout'],
    ['java.io.FileNotFoundException: open failed: ENOENT (No such file or directory)', 'no-file'],
    ['Failed to decode image', 'decode'],
    ['Something else entirely', 'other'],
  ])('%s → %s', (message, reason) => {
    expect(displayFailureReason(message)).toBe(reason);
  });

  test('no words at all are `other`', () => {
    expect(displayFailureReason(undefined)).toBe('other');
  });

  // A signed link's token can hold «-404-»; only a status the text names counts.
  test('a number inside the link is not taken for a status', () => {
    expect(displayFailureReason(`Could not load ${LINK}-404-x`)).toBe('other');
  });
});

test('a file on the phone is local, a link is remote', () => {
  expect(mediaSourceOf('file:///data/user/0/app/files/task-media/m1.jpg')).toBe('local');
  expect(mediaSourceOf(LINK)).toBe('remote');
});

test('reports the kind, the place, the source and the word, with the id and nothing else', () => {
  reportMediaNotShown(failure({ mediaId: 'only-one' }));

  expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  expect(Sentry.captureMessage).toHaveBeenCalledWith('Media not shown', {
    level: 'warning',
    tags: { kind: 'photo', surface: 'strip', source: 'remote', reason: 'http-403' },
    extra: { mediaId: 'only-one' },
    fingerprint: ['media-trouble', 'Media not shown', 'http-403'],
  });
  const sent = JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls);
  expect(sent).not.toContain('token');
  expect(sent).not.toContain('supabase');
  expect(sent).not.toContain('m1.jpg');
});

test('a list redrawn reports the same file in the same place once', () => {
  const report = freshReporter();

  report();
  report();
  report({ surface: 'viewer' });
  report({ mediaId: 'm2' });

  expect(Sentry.captureMessage).toHaveBeenCalledTimes(3);
});

test('a link that could not be fetched without signal is the stairwell, not a fault', () => {
  const report = freshReporter();

  report({ message: 'java.net.UnknownHostException: Unable to resolve host' });
  report({ mediaId: 'm2', message: 'The request timed out.' });
  onlineManager.setOnline(false);
  report({ mediaId: 'm3' });

  expect(Sentry.captureMessage).not.toHaveBeenCalled();
});

test('a file on the phone that will not draw is reported even without signal', () => {
  const report = freshReporter();
  onlineManager.setOnline(false);

  report({
    uri: 'file:///data/user/0/app/files/task-media/m1.jpg',
    message: 'open failed: ENOENT (No such file or directory)',
  });

  expect(Sentry.captureMessage).toHaveBeenCalledWith(
    'Media not shown',
    expect.objectContaining({
      tags: { kind: 'photo', surface: 'strip', source: 'local', reason: 'no-file' },
    }),
  );
});

test('a report skipped for the stairwell is sent once signal is back', () => {
  const report = freshReporter();
  onlineManager.setOnline(false);
  report();
  onlineManager.setOnline(true);

  report();

  expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
});
