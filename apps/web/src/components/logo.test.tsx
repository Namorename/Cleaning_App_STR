import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { LOGO_MARK_SOURCES, LOGO_SOURCES, Logo } from './logo';

const PUBLIC = path.resolve(__dirname, '../../public');

describe('Logo', () => {
  test('shows each theme its own picture, behind the class that paints the panel', () => {
    render(<Logo alt="woom" />);
    const [light, dark] = screen.getAllByRole('img', { name: 'woom' });

    // The hidden one is display: none, so a screen reader meets one logo.
    expect(light).toHaveAttribute('src', '/brand/logo-light.svg');
    expect(light).toHaveClass('dark:hidden');
    expect(dark).toHaveAttribute('src', '/brand/logo-dark.svg');
    expect(dark).toHaveClass('hidden', 'dark:block');
  });

  test('fits a logo of any shape into the 192×48 frame, at its left edge', () => {
    const { container } = render(<Logo alt="woom" />);

    expect(container.firstElementChild).toHaveClass('h-12', 'w-full');
    for (const picture of screen.getAllByRole('img')) {
      expect(picture).toHaveClass('object-contain', 'object-left');
    }
  });

  test('in the strip of icons, shows the mark alone, one per theme, in a 44 px square', () => {
    const { container } = render(<Logo alt="woom" variant="mark" />);
    const [light, dark] = screen.getAllByRole('img', { name: 'woom' });

    expect(light).toHaveAttribute('src', '/brand/logo-mark-light.svg');
    expect(light).toHaveClass('dark:hidden');
    expect(dark).toHaveAttribute('src', '/brand/logo-mark-dark.svg');
    expect(dark).toHaveClass('hidden', 'dark:block');
    expect(container.firstElementChild).toHaveClass('size-11');
  });
});

/**
 * The owner replaces these files without touching the code
 * (docs/redesign-plan.md, 6.1); what he sends has to meet the same rules.
 */
describe('the logo files', () => {
  const sources = [...Object.values(LOGO_SOURCES), ...Object.values(LOGO_MARK_SOURCES)];

  test.each(sources)('%s is served from public/', (source) => {
    expect(existsSync(path.join(PUBLIC, source))).toBe(true);
  });

  const vectors = sources.filter((source) => source.endsWith('.svg'));

  test.each(vectors)('%s keeps its proportions and draws its words in curves', (source) => {
    const svg = readFileSync(path.join(PUBLIC, source), 'utf8');

    // Without a viewBox the picture has no proportions to fit by.
    expect(svg).toMatch(/<svg[^>]*\sviewBox="[\d.\s-]+"/);
    // An SVG in <img> loads no font and nothing from outside: a word in
    // <text> would come out in a fallback face, a linked file not at all.
    expect(svg).not.toMatch(/<text|<foreignObject|<script|@font-face|@import|href="(?!#)/);
  });
});
