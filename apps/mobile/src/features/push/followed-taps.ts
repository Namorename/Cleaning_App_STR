import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The taps on pushes already followed, across runs of the app.
 *
 * Android delivers the push that started the app again every time it
 * recreates the app after killing it in the background — from the same launch
 * intent (expo-notifications' lifecycle listener does not look at the saved
 * state). A memory of this run alone would follow it again after every
 * restore (docs/f11-native-review.md, П-1). The taps are kept on the disk as
 * `identifier@date`, unique to each delivery; not a secret.
 */
const KEY = 'push-followed-taps';

/** Enough for the taps of a working day; the oldest go first. */
const KEPT = 20;

/** This run's, checked first: the tabs draw again while the disk is still being read. */
const followedThisRun = new Set<string>();

async function followedEarlier(): Promise<string[]> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    const parsed: unknown = stored === null ? [] : JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((tap): tap is string => typeof tap === 'string')
      : [];
  } catch {
    // A disk that cannot be read: the tap is followed, once in this run.
    return [];
  }
}

/**
 * Whether the tap is new — neither followed in this run nor in an earlier
 * one — and, when it is, records it as followed.
 */
export async function isNewTap(tapId: string): Promise<boolean> {
  if (followedThisRun.has(tapId)) {
    return false;
  }
  // Marked before the disk is read: a second call in the meantime is not new.
  followedThisRun.add(tapId);
  const earlier = await followedEarlier();
  if (earlier.includes(tapId)) {
    return false;
  }
  await AsyncStorage.setItem(KEY, JSON.stringify([...earlier, tapId].slice(-KEPT))).catch(
    () => undefined,
  );
  return true;
}
