import { Platform } from 'react-native';

import { mediaFileUri, storedMediaPath } from '../media-path';

/**
 * Where a kept capture is remembered (risk 1 of docs/ios-first-device-checklist.md).
 *
 * On an iPhone the app's folder carries the install's id —
 * `…/Application/<UUID>/Documents/` — and a new build may get another one. A
 * full path remembered by the old build then points into a folder that is not
 * there: the thumbnail goes blank and the upload never finds its file. So a
 * kept file is remembered by its place inside the documents, and the full path
 * is made at the moment it is used, from the documents of this run.
 */

const NOW = 'file:///var/mobile/Containers/Data/Application/NEW-UUID/Documents/';
const BEFORE = 'file:///var/mobile/Containers/Data/Application/OLD-UUID/Documents/';
const ANDROID = 'file:///data/user/0/com.strops.app/files/';

jest.mock('expo-file-system', () => {
  class MockDirectory {
    readonly uri: string;
    constructor(base: string | { uri: string }, name: string) {
      this.uri = `${typeof base === 'string' ? base : base.uri}${name}/`;
    }
  }
  class MockFile {
    readonly uri: string;
    constructor(base: string | { uri: string }, name?: string) {
      this.uri = typeof base === 'string' ? base : `${base.uri}${name ?? ''}`;
    }
  }
  const paths = { document: 'file:///var/mobile/Containers/Data/Application/NEW-UUID/Documents/' };
  return { Directory: MockDirectory, File: MockFile, Paths: paths, __paths: paths };
});

const { __paths: paths } = jest.requireMock('expo-file-system') as {
  __paths: { document: string };
};

afterEach(() => {
  paths.document = NOW;
  jest.restoreAllMocks();
});

describe('what is remembered', () => {
  test('a kept file is remembered by its place in the documents, not its full path', () => {
    expect(storedMediaPath(`${BEFORE}task-media/m1.jpg`)).toBe('task-media/m1.jpg');
  });

  test('a place already relative stays as it is', () => {
    expect(storedMediaPath('task-media/m1.jpg')).toBe('task-media/m1.jpg');
  });

  test('an Android path is remembered the same way', () => {
    expect(storedMediaPath(`${ANDROID}task-media/m1.mp4`)).toBe('task-media/m1.mp4');
  });

  test.each([
    [
      'a capture still in the cache',
      'file:///var/mobile/Containers/Data/Application/X/Library/Caches/ImagePicker/a.jpg',
    ],
    [
      'a signed link',
      'https://project.supabase.co/storage/v1/object/sign/task-media/a.jpg?token=t',
    ],
    ['a blob of the browser build', 'blob:http://localhost:8090/3c1d'],
    ['a deeper path under task-media', `${NOW}task-media/nested/a.jpg`],
    ['an empty name', `${NOW}task-media/`],
  ])('%s is not ours to shorten', (_label, uri) => {
    expect(storedMediaPath(uri)).toBe(uri);
  });
});

describe('what is used', () => {
  test('a remembered place becomes a full path in the documents of this run', () => {
    expect(mediaFileUri('task-media/m1.jpg')).toBe(`${NOW}task-media/m1.jpg`);
  });

  test("an old record's full path from the install before is moved to this one", () => {
    expect(mediaFileUri(`${BEFORE}task-media/m1.jpg`)).toBe(`${NOW}task-media/m1.jpg`);
  });

  test('a full path of this install is the same path', () => {
    expect(mediaFileUri(`${NOW}task-media/m1.jpg`)).toBe(`${NOW}task-media/m1.jpg`);
  });

  test('on Android, where the folder does not move, an old full path stays the same', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    paths.document = ANDROID;

    expect(mediaFileUri(`${ANDROID}task-media/m1.mp4`)).toBe(`${ANDROID}task-media/m1.mp4`);
    expect(mediaFileUri('task-media/m1.mp4')).toBe(`${ANDROID}task-media/m1.mp4`);
  });

  test.each([
    [
      'a capture still in the cache',
      'file:///var/mobile/Containers/Data/Application/X/Library/Caches/a.mov',
    ],
    [
      'a signed link',
      'https://project.supabase.co/storage/v1/object/sign/task-media/a.jpg?token=t',
    ],
  ])('%s is used as it is', (_label, uri) => {
    expect(mediaFileUri(uri)).toBe(uri);
  });

  test('the browser build has no documents: its blob URL is used as it is', () => {
    jest.replaceProperty(Platform, 'OS', 'web');

    expect(mediaFileUri('blob:http://localhost:8090/3c1d')).toBe('blob:http://localhost:8090/3c1d');
  });
});
