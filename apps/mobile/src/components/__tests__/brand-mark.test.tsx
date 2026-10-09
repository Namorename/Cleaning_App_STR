import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ImageStyle } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

import { BrandMark } from '../brand-mark';

/**
 * The mark above the sign-in heading (docs/redesign-plan.md §6.2): a picture in
 * the bundle, a light and a dark one by the theme, rendered from the panel's
 * mark-only files. Until the owner's logo it is the Apricot sketch. It sits in
 * `assets/brand`, apart from the native icon and splash, so the native check
 * never takes it for one of them.
 */

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));
const scheme = jest.mocked(useColorScheme);

const BRAND = path.resolve(__dirname, '../../../assets/brand');

/** Width and height of a PNG, from its header. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(path.join(BRAND, file));
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function markSource(): string {
  const image = screen.getByTestId('brand-mark', { includeHiddenElements: true });
  return JSON.stringify(image.props.source);
}

beforeEach(() => {
  scheme.mockReturnValue('light');
});

test.each([
  ['logo-light.png', 72],
  ['logo-light@2x.png', 144],
  ['logo-light@3x.png', 216],
  ['logo-dark.png', 72],
  ['logo-dark@2x.png', 144],
  ['logo-dark@3x.png', 216],
])('%s is the 72 dp mark at its density: %d px square', (file, side) => {
  expect(pngSize(file)).toEqual({ width: side, height: side });
});

test('the light theme shows the mark drawn for it, 72 dp square', async () => {
  await render(<BrandMark testID="brand-mark" />);

  expect(markSource()).toContain('logo-light');
  const style = StyleSheet.flatten(
    screen.getByTestId('brand-mark', { includeHiddenElements: true }).props.style,
  ) as ImageStyle;
  expect(style).toMatchObject({ width: 72, height: 72 });
});

test('the dark theme shows the dark one', async () => {
  scheme.mockReturnValue('dark');

  await render(<BrandMark testID="brand-mark" />);

  expect(markSource()).toContain('logo-dark');
});

test('it is decoration: the reader skips it, the heading under it names the screen', async () => {
  await render(<BrandMark testID="brand-mark" />);

  expect(screen.queryByRole('image')).toBeNull();
  expect(
    isHiddenFromAccessibility(screen.getByTestId('brand-mark', { includeHiddenElements: true })),
  ).toBe(true);
});
