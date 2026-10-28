import { discardFile, openFileChunks } from '../file';

/**
 * A video is read for its upload a piece at a time through a file handle, so
 * a 45 MB file never sits whole in the app's memory (docs/tech-plan.md §7.5);
 * and it is removed once the server has it, as often as that is asked.
 */

interface MockHandleShape {
  mode: string | undefined;
  offset: number | null;
  reads: [number, number][];
  isClosed: boolean;
}

jest.mock('expo-file-system', () => {
  const files = new Map<string, number>();
  const handles: unknown[] = [];
  const deleted: string[] = [];

  class MockHandle {
    offset: number | null = 0;
    reads: [number, number][] = [];
    isClosed = false;
    readonly mode: string | undefined;
    readonly size: number;

    constructor(openedAs: string | undefined, length: number) {
      this.mode = openedAs;
      this.size = length;
    }

    readBytes(length: number): Uint8Array {
      const start = this.offset ?? 0;
      this.reads.push([start, length]);
      const count = Math.max(0, Math.min(length, this.size - start));
      this.offset = start + count;
      return new Uint8Array(count).fill(start % 256);
    }

    close(): void {
      this.isClosed = true;
    }
  }

  class MockFile {
    readonly uri: string;

    // A path, or a directory and a name in it, as the real constructor takes them.
    constructor(base: string | { uri: string }, name?: string) {
      this.uri = typeof base === 'string' ? base : `${base.uri}${name ?? ''}`;
    }

    get exists(): boolean {
      return files.has(this.uri);
    }

    get size(): number {
      return files.get(this.uri) ?? 0;
    }

    open(mode?: string): MockHandle {
      if (!files.has(this.uri)) {
        throw new Error(`No file at ${this.uri}`);
      }
      const handle = new MockHandle(mode, files.get(this.uri) ?? 0);
      handles.push(handle);
      return handle;
    }

    delete(): void {
      if (!files.delete(this.uri)) {
        throw new Error(`No file at ${this.uri}`);
      }
      deleted.push(this.uri);
    }
  }

  return {
    File: MockFile,
    // The documents a kept file is looked for in (features/media/media-path.ts).
    Directory: class {
      readonly uri: string;
      constructor(base: string, name: string) {
        this.uri = `${base}${name}/`;
      }
    },
    Paths: { document: 'file:///documents/' },
    FileMode: { ReadOnly: 'r' },
    __files: files,
    __handles: handles,
    __deleted: deleted,
  };
});

const fs = jest.requireMock('expo-file-system') as {
  __files: Map<string, number>;
  __handles: MockHandleShape[];
  __deleted: string[];
};

const VIDEO = 'file:///documents/task-media/m1.mp4';

beforeEach(() => {
  fs.__files.clear();
  fs.__handles.length = 0;
  fs.__deleted.length = 0;
});

describe('openFileChunks', () => {
  test('knows the size and reads only the piece asked for, at its offset', async () => {
    // Arrange
    fs.__files.set(VIDEO, 10);

    // Act
    const chunks = await openFileChunks(VIDEO);
    const piece = await chunks.read(4, 3);

    // Assert
    expect(chunks.size).toBe(10);
    expect(Array.from(piece)).toEqual([4, 4, 4]);
    const [handle] = fs.__handles;
    expect(handle.mode).toBe('r');
    expect(handle.reads).toEqual([[4, 3]]);
  });

  test('reads pieces in any order: each one seeks first', async () => {
    fs.__files.set(VIDEO, 10);
    const chunks = await openFileChunks(VIDEO);

    await chunks.read(6, 4);
    await chunks.read(0, 6);

    expect(fs.__handles[0].reads).toEqual([
      [6, 4],
      [0, 6],
    ]);
  });

  test('lets go of the file when closed', async () => {
    fs.__files.set(VIDEO, 10);
    const chunks = await openFileChunks(VIDEO);

    chunks.close();

    expect(fs.__handles[0].isClosed).toBe(true);
  });

  test('a file that is not there fails, for the attempt to say so', async () => {
    await expect(openFileChunks(VIDEO)).rejects.toThrow(/No file/);
  });
});

describe('discardFile', () => {
  test('removes the file; removing it again, or one that never was, is not an error', () => {
    fs.__files.set(VIDEO, 10);

    discardFile(VIDEO);
    discardFile(VIDEO);
    discardFile('file:///documents/task-media/never.mp4');

    expect(fs.__deleted).toEqual([VIDEO]);
  });
});
