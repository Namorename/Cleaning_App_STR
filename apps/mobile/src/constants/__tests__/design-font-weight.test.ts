import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * No `fontWeight` in the phone's styles outside the text component
 * (docs/redesign-plan.md §8 p.6).
 *
 * On Android a font loaded at run time has one face: a weight set on it is
 * ignored or faked with the system's bold, so the custom font breaks without a
 * word. `components/text.tsx` turns each weight into a family of its own; any
 * other `fontWeight` is a place where Nunito will not look like Nunito.
 *
 * The screens built before the redesign still carry theirs until 5.4 moves
 * them onto the components, so this is a ratchet: each file may keep at most
 * the uses it had, a new file has none, and an allowance that is no longer
 * needed must be lowered with the file — the numbers only ever go down.
 */

const SRC = path.resolve(__dirname, '../..');

/** Where a weight is allowed: the one place that turns it into a family. */
const TEXT_COMPONENT = 'components/text.tsx';

/**
 * Today's uses, per file (counted 2026-10-03 on redesign-phone: 84 in 29 files,
 * as on f11-native; the plan's 72 in 22 was main before F11). Down since: the
 * settings' section frame and language choice moved onto the components, and
 * the sign-in screen.
 */
const ALLOWANCE: Readonly<Record<string, number>> = {
  'components/list-action.tsx': 1,
};

const SOURCE = /\.(ts|tsx)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(full);
    }
    return SOURCE.test(entry.name) ? [full] : [];
  });
}

function usesIn(file: string): number {
  return (readFileSync(file, 'utf8').match(/fontWeight/g) ?? []).length;
}

const counts = new Map(
  sourceFiles(SRC)
    .map((file) => [path.relative(SRC, file).split(path.sep).join('/'), usesIn(file)] as const)
    .filter(([file]) => file !== TEXT_COMPONENT),
);

test('the text component exists: it is where a weight becomes a family', () => {
  expect(existsSync(path.join(SRC, TEXT_COMPONENT))).toBe(true);
});

test('no file sets more fontWeight than it had, and a new file sets none', () => {
  const over = [...counts]
    .filter(([file, uses]) => uses > (ALLOWANCE[file] ?? 0))
    .map(
      ([file, uses]) =>
        `${file}: ${uses} (allowed ${ALLOWANCE[file] ?? 0}) — draw the text with <Text>`,
    );
  expect(over).toEqual([]);
});

test('an allowance goes down with its file', () => {
  const stale = Object.entries(ALLOWANCE)
    .filter(([file, allowed]) => (counts.get(file) ?? 0) < allowed)
    .map(([file, allowed]) => `${file}: lower ${allowed} to ${counts.get(file) ?? 0}`);
  expect(stale).toEqual([]);
});
