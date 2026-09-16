import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { PhotoSource } from '../photo-source';

/**
 * The mark exists so a manager is never left to assume. It says what the app
 * declared — the server cannot see a camera — and it says it in words, because
 * a coloured corner tells a colour-blind reader nothing.
 */

test('a photo taken on the spot carries no mark, so the marks that appear are read', () => {
  const { container } = render(<PhotoSource source="camera" />);

  expect(container).toBeEmptyDOMElement();
});

test('a picked photo says so', () => {
  render(<PhotoSource source="gallery" />);

  expect(screen.getByText('из галереи')).toBeTruthy();
});

test('a photo from a build that declared nothing says that, not "camera"', () => {
  render(<PhotoSource source="unknown" />);

  expect(screen.getByText('источник не указан')).toBeTruthy();
});
