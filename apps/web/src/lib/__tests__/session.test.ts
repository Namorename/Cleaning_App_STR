import { describe, expect, test } from 'vitest';

import { isPanelRole, roleOf } from '../session';

describe('roleOf', () => {
  test('reads the role the server wrote into app_metadata', () => {
    expect(roleOf({ app_metadata: { role: 'manager' } })).toBe('manager');
  });

  test('ignores a role the client could have written itself', () => {
    // user_metadata is filled at sign-up by the client; it must never open the panel.
    expect(roleOf({ app_metadata: {} })).toBeNull();
    expect(roleOf(null)).toBeNull();
  });
});

describe('isPanelRole', () => {
  test('lets managers and admins in, nobody else', () => {
    expect(isPanelRole('manager')).toBe(true);
    expect(isPanelRole('admin')).toBe(true);
    expect(isPanelRole('cleaner')).toBe(false);
    expect(isPanelRole('tech')).toBe(false);
    expect(isPanelRole(null)).toBe(false);
  });
});
