import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';

const SRC = path.resolve(__dirname, '../..');

/** Every component file of the panel, tests aside. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(full);
    }
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [full] : [];
  });
}

/** The classes of a file: `className="…"` and the first string handed to `cn(`. */
function classLists(source: string): string[] {
  const attributes = [...source.matchAll(/className="([^"]*)"/g)];
  const merged = [...source.matchAll(/cn\(\s*["'`]([^"'`]*)["'`]/g)];
  return [...attributes, ...merged].map((match) => match[1]);
}

/** A grid with no column of its own below its first breakpoint: there it is `auto`. */
function isImplicitGrid(classes: string): boolean {
  const tokens = classes.split(/\s+/);
  return tokens.includes('grid') && !tokens.some((token) => token.startsWith('grid-cols-'));
}

/** The component files a file imports, `./x` or `@/x`: what a dialog draws inside it. */
function importedComponents(file: string, source: string): string[] {
  return [...source.matchAll(/from '((?:\.{1,2}|@)\/[^']+)'/g)]
    .map(([, target]) =>
      target.startsWith('@/')
        ? path.join(SRC, `${target.slice(2)}.tsx`)
        : path.resolve(path.dirname(file), `${target}.tsx`),
    )
    .filter((candidate) => existsSync(candidate));
}

/** The files that draw a dialog, and the components drawn inside them. */
function dialogFiles(): string[] {
  const drawing = sourceFiles(SRC).filter((file) =>
    readFileSync(file, 'utf8').includes('<DialogContent'),
  );
  const inside = drawing.flatMap((file) => importedComponents(file, readFileSync(file, 'utf8')));
  return [...new Set([...drawing, ...inside])].filter(
    (file) => !file.includes(`${path.sep}components${path.sep}ui${path.sep}`),
  );
}

/**
 * The card of every dialog is a grid. Left to itself a grid's one column is
 * `auto`: as wide as its widest part will go, and a <select> goes as wide as
 * its longest option. A listing's long name pushed the fields, the buttons and
 * the description past the card's right edge (the owner's report of
 * 2026-10-12, «Новое задание»). One column of `minmax(0, 1fr)` is the card's
 * own width, whatever a part inside asks for.
 */
describe('the dialog card', () => {
  test('lays its parts in one column of its own (grid-cols-1), not the grid’s `auto` one', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новое задание</DialogTitle>
            <DialogDescription>После создания откроется страница задания.</DialogDescription>
          </DialogHeader>
          <select aria-label="Объект">
            <option>Residence Vinohrady Garden Deluxe Two-Bedroom Apartment — 2109 B</option>
          </select>
        </DialogContent>
      </Dialog>,
    );

    const card = screen.getByRole('dialog', { name: 'Новое задание' });
    expect(card).toHaveAttribute('data-slot', 'dialog-content');
    expect(card).toHaveClass('grid', 'grid-cols-1');
  });

  test('keeps the column when a dialog sets its own width', () => {
    render(
      <Dialog open>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>Новая уборка</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    const card = screen.getByRole('dialog', { name: 'Новая уборка' });
    expect(card).toHaveClass('grid-cols-1', 'sm:max-w-lg');
    expect(card).not.toHaveClass('sm:max-w-sm');
  });

  // A problem's title is a dialog's description in places; one long word —
  // a link pasted in — would run past the card as well.
  test('breaks a word too long for the card in its title and its description', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Назначить</DialogTitle>
          <DialogDescription>https://example.com/a-very-long-link-without-a-space</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole('heading', { name: 'Назначить' })).toHaveClass('wrap-break-word');
    expect(screen.getByText(/a-very-long-link/)).toHaveClass('wrap-break-word');
  });
});

/**
 * The same `auto` column one level down: «Новая уборка», the staff form and
 * the supplies catalog put their fields in `grid sm:grid-cols-2`, which below
 * 640 px is one `auto` column again — and a long listing name pushed the
 * fields 161 px past a 390 px screen. A grid in a dialog, or in a component a
 * dialog draws (the assignment form, a cleaning's departure), says its narrow
 * column too.
 */
describe('the grids of the dialogs', () => {
  test('declare their column on narrow screens as well', () => {
    const implicit = dialogFiles()
      .flatMap((file) =>
        classLists(readFileSync(file, 'utf8'))
          .filter(isImplicitGrid)
          .map((classes) => `${path.relative(SRC, file).split(path.sep).join('/')}: ${classes}`),
      );

    expect(implicit).toEqual([]);
  });
});
