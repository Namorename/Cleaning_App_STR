import { renderHook } from '@testing-library/react-native';

import { restoredFromDisk, withClient } from '@/testing/restored-cache';

import { mediaKeys } from '../keys';
import { useLocalMedia } from '../use-media';

jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));

/** A capture as the build before 9442c80 remembered it: no declared source. */
const kept = {
  id: 'm1',
  kind: 'photo',
  uri: 'file:///kept/m1.jpg',
  mimeType: 'image/jpeg',
  byteSize: 1200,
  width: 1600,
  height: 1200,
  durationSec: null,
  takenAt: '2026-09-16T10:00:00+00:00',
};

test('the ledger restored from the query cache is read by the same rules as the store', async () => {
  // Arrange: staleTime is infinite, so this copy is never reloaded in a session.
  // A zero-byte record from before c98e53c would loop the retry for ever.
  const client = restoredFromDisk(mediaKeys.local, {
    m1: kept,
    m2: { ...kept, id: 'm2', byteSize: 0 },
  });

  // Act
  const { result } = await renderHook(() => useLocalMedia(), { wrapper: withClient(client) });

  // Assert
  expect(Object.keys(result.current.data ?? {})).toEqual(['m1']);
  expect(result.current.data?.m1.source).toBeUndefined();
});

test('a ledger it cannot read is empty, as the store treats it, not an error', async () => {
  // Arrange
  const client = restoredFromDisk(mediaKeys.local, { m1: { id: 'm1' } });

  // Act
  const { result } = await renderHook(() => useLocalMedia(), { wrapper: withClient(client) });

  // Assert
  expect(result.current.isError).toBe(false);
  expect(result.current.data).toEqual({});
});
