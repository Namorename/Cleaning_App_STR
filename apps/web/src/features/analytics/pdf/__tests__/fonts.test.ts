import { expect, test, vi } from 'vitest';

const register = vi.fn();
vi.mock('@react-pdf/renderer', () => ({
  Font: {
    register: (...args: unknown[]) => register(...args),
    registerHyphenationCallback: vi.fn(),
  },
}));

import { loadReportFonts } from '../fonts';

const SOURCES = { regular: '/r.ttf', bold: '/b.ttf', heavy: '/h.ttf' };

test('a font that does not come fails this press only: nothing is kept to fail the next', async () => {
  const missing = vi.fn(async (url: string) => ({ ok: url !== '/b.ttf' }));
  await expect(loadReportFonts(SOURCES, missing)).rejects.toThrow();
  expect(register).not.toHaveBeenCalled();

  const fine = vi.fn(async () => ({ ok: true }));
  await loadReportFonts(SOURCES, fine);
  expect(register).toHaveBeenCalledTimes(1);

  await loadReportFonts(SOURCES, fine);
  expect(register).toHaveBeenCalledTimes(1);
});
