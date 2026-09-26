import { DEFAULT_DEPTH, isDepth, type Depth } from './dates';

/**
 * What the calendar remembers between visits: the depth and the closed
 * groups (docs/f10-plan.md, 7.2).
 *
 * A convenience and nothing more. Storage can be missing or throw — a private
 * window, blocked site data, the server render — and then the calendar opens
 * on a week with every group open, never on an error.
 */

const DEPTH_KEY = 'str-ops.calendar.depth';
const COLLAPSED_KEY = 'str-ops.calendar.collapsed';

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: Storage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Remembering is a nicety; the calendar works the same without it.
  }
}

export function readDepth(storage: Storage | null = browserStorage()): Depth {
  const value = Number(read(storage, DEPTH_KEY));
  return isDepth(value) ? value : DEFAULT_DEPTH;
}

export function writeDepth(depth: Depth, storage: Storage | null = browserStorage()): void {
  write(storage, DEPTH_KEY, String(depth));
}

export function readCollapsed(storage: Storage | null = browserStorage()): Set<number> {
  try {
    const parsed: unknown = JSON.parse(read(storage, COLLAPSED_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is number => Number.isInteger(id)))
      : new Set();
  } catch {
    return new Set();
  }
}

export function writeCollapsed(
  ids: ReadonlySet<number>,
  storage: Storage | null = browserStorage(),
): void {
  write(storage, COLLAPSED_KEY, JSON.stringify([...ids]));
}
