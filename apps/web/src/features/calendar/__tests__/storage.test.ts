import { describe, expect, test } from 'vitest';

import { readCollapsed, readDepth, writeCollapsed, writeDepth } from '../storage';

/** A storage that keeps what it is given, like the browser's. */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** A private window, or site data blocked: every call throws. */
const brokenStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
} as unknown as Storage;

describe('the depth the manager chose', () => {
  test('is remembered', () => {
    const storage = memoryStorage();

    writeDepth(30, storage);

    expect(readDepth(storage)).toBe(30);
  });

  test('falls back to a week when nothing, or nonsense, is stored', () => {
    const storage = memoryStorage();
    expect(readDepth(storage)).toBe(7);

    storage.setItem('str-ops.calendar.depth', '12');
    expect(readDepth(storage)).toBe(7);
  });

  test('a storage that throws costs the memory, not the screen', () => {
    expect(readDepth(brokenStorage)).toBe(7);
    expect(() => writeDepth(3, brokenStorage)).not.toThrow();
  });
});

describe('the groups the manager closed', () => {
  test('are remembered', () => {
    const storage = memoryStorage();

    writeCollapsed(new Set([10, 20]), storage);

    expect([...readCollapsed(storage)].sort()).toEqual([10, 20]);
  });

  test('start open when nothing, or nonsense, is stored', () => {
    const storage = memoryStorage();
    expect(readCollapsed(storage).size).toBe(0);

    storage.setItem('str-ops.calendar.collapsed', '{"not":"a list"}');
    expect(readCollapsed(storage).size).toBe(0);

    storage.setItem('str-ops.calendar.collapsed', '[1, "two", 3]');
    expect([...readCollapsed(storage)].sort()).toEqual([1, 3]);
  });

  test('a storage that throws leaves every group open', () => {
    expect(readCollapsed(brokenStorage).size).toBe(0);
    expect(() => writeCollapsed(new Set([1]), brokenStorage)).not.toThrow();
  });
});
