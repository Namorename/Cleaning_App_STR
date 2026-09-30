import type * as FollowedTaps from '../followed-taps';

/**
 * Android delivers the push that started the app again every time it
 * recreates the app after killing it in the background — from the same
 * launch intent. A tap is followed once across runs, not once per run
 * (docs/f11-native-review.md, П-1).
 */

// The disk outlives a run of the app; the module's memory does not.
const disk = jest.requireMock<{
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  clear: () => Promise<void>;
}>('@react-native-async-storage/async-storage');

/** The module as a new run of the app finds it: memory empty, the disk as it was. */
function newRun(): typeof FollowedTaps {
  let module: typeof FollowedTaps | undefined;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () => disk);
    module = jest.requireActual<typeof FollowedTaps>('../followed-taps');
  });
  if (module === undefined) {
    throw new Error('The module was not loaded');
  }
  return module;
}

beforeEach(async () => {
  await disk.clear();
  jest.restoreAllMocks();
});

test('a tap is new once in a run', async () => {
  const run = newRun();

  await expect(run.isNewTap('a@1')).resolves.toBe(true);
  await expect(run.isNewTap('a@1')).resolves.toBe(false);
  await expect(run.isNewTap('a@2')).resolves.toBe(true);
});

test('a tap followed in an earlier run is not new in the next one', async () => {
  await expect(newRun().isNewTap('launch@1')).resolves.toBe(true);

  const restored = newRun();

  await expect(restored.isNewTap('launch@1')).resolves.toBe(false);
  await expect(restored.isNewTap('later@2')).resolves.toBe(true);
});

test('the taps of a working day are kept; the oldest go first', async () => {
  const run = newRun();
  for (let tap = 1; tap <= 21; tap += 1) {
    await run.isNewTap(`t@${tap}`);
  }

  const restored = newRun();

  await expect(restored.isNewTap('t@21')).resolves.toBe(false);
  await expect(restored.isNewTap('t@2')).resolves.toBe(false);
  await expect(restored.isNewTap('t@1')).resolves.toBe(true);
});

test('a disk that cannot be read still lets a tap be followed, once in the run', async () => {
  const run = newRun();
  jest.spyOn(disk, 'getItem').mockRejectedValue(new Error('storage unavailable'));

  await expect(run.isNewTap('x@1')).resolves.toBe(true);
  await expect(run.isNewTap('x@1')).resolves.toBe(false);
});

test('whatever else is found under its key is ignored', async () => {
  await disk.setItem('push-followed-taps', '{"not":"a list"}');

  await expect(newRun().isNewTap('y@1')).resolves.toBe(true);
});
