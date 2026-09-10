import { describe, expect, test } from 'vitest';

import { safeNext } from '../safe-next';

describe('safeNext', () => {
  test('keeps a path on the panel, with its query and hash', () => {
    expect(safeNext('/problems')).toBe('/problems');
    expect(safeNext('/problems/1?tab=list#top')).toBe('/problems/1?tab=list#top');
  });

  test('refuses everything that would leave the panel', () => {
    for (const value of [
      '//evil.com',
      '/\\evil.com',
      '/\\\\evil.com',
      'https://evil.com/problems',
      'javascript:alert(1)',
      'problems',
      '',
      null,
      undefined,
      '/%5C%5Cevil.com/..//evil.com',
    ]) {
      const result = safeNext(value);
      expect(result.startsWith('/')).toBe(true);
      expect(result.startsWith('//')).toBe(false);
      expect(result).not.toContain('evil.com');
      expect(result).not.toContain('javascript');
    }
    expect(safeNext('//evil.com')).toBe('/dashboard');
    expect(safeNext('/\\evil.com')).toBe('/dashboard');
  });
});
