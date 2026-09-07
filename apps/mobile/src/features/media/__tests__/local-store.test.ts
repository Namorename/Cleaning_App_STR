import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  forgetLocalMedia,
  loadLocalMedia,
  rememberLocalMedia,
  toLocalRecord,
} from '../local-store';

const captured = {
  id: 'm1',
  kind: 'photo' as const,
  uri: 'file:///kept/m1.jpg',
  mimeType: 'image/jpeg',
  byteSize: 100,
  width: 1600,
  height: 1200,
  durationSec: null,
  takenAt: '2026-09-07T10:00:00+00:00',
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('remembers a capture and gives it back after a restart', async () => {
  await rememberLocalMedia(toLocalRecord(captured));

  await expect(loadLocalMedia()).resolves.toEqual({ m1: captured });
});

test('forgets one without touching the others', async () => {
  await rememberLocalMedia(toLocalRecord(captured));
  await rememberLocalMedia(toLocalRecord({ ...captured, id: 'm2' }));

  const rest = await forgetLocalMedia('m1');

  expect(Object.keys(rest)).toEqual(['m2']);
});

test('reads a corrupted store as empty rather than failing', async () => {
  await AsyncStorage.setItem('str-ops.media-local', '{not json');

  await expect(loadLocalMedia()).resolves.toEqual({});
});
