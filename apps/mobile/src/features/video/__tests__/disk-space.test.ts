import { freeDiskBytes } from '../disk-space';

/** What the phone's file system answers, or throws, when asked for its free space. */
const mockSpace: { read: () => number } = { read: () => 0 };

jest.mock('expo-file-system', () => ({
  Paths: {
    get availableDiskSpace() {
      return mockSpace.read();
    },
  },
}));
jest.mock('@/lib/sentry', () => ({ reportError: jest.fn() }));

test('says how many bytes are free', () => {
  mockSpace.read = () => 3_500_000_000;

  expect(freeDiskBytes()).toBe(3_500_000_000);
});

// Not knowing is not a reason to refuse the recording: the camera's size limit holds.
test('a file system that cannot say answers nothing rather than a guess', () => {
  mockSpace.read = () => {
    throw new Error('statfs failed');
  };

  expect(freeDiskBytes()).toBeNull();
});

test('and so does one that answers nonsense', () => {
  mockSpace.read = () => Number.NaN;

  expect(freeDiskBytes()).toBeNull();
});
