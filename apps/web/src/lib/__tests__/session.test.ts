import { describe, expect, test } from 'vitest';

import { homeOf, isPanelRole, isPathOpenTo, panelAccessOf, roleOf } from '../session';

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
    expect(isPanelRole('head_tech')).toBe(false);
    expect(isPanelRole(null)).toBe(false);
  });
});

// The owner's decision of 2026-10-17: the head technician writes and publishes
// the knowledge base, so the panel opens to him — that section alone and his
// own settings. The rest stays the office's.
describe('panelAccessOf', () => {
  test('the whole panel for managers and admins', () => {
    expect(panelAccessOf('manager')).toBe('full');
    expect(panelAccessOf('admin')).toBe('full');
  });

  test('the knowledge base for the head technician', () => {
    expect(panelAccessOf('head_tech')).toBe('knowledge');
  });

  test('nothing for the field staff, nor for a token without a role', () => {
    expect(panelAccessOf('cleaner')).toBeNull();
    expect(panelAccessOf('tech')).toBeNull();
    expect(panelAccessOf('owner')).toBeNull();
    expect(panelAccessOf(null)).toBeNull();
  });
});

describe('isPathOpenTo', () => {
  test('every page is the office’s', () => {
    for (const path of ['/', '/dashboard', '/tasks', '/knowledge', '/settings']) {
      expect(isPathOpenTo('full', path)).toBe(true);
    }
  });

  test('the head technician reaches the knowledge base and his settings, nothing else', () => {
    expect(isPathOpenTo('knowledge', '/knowledge')).toBe(true);
    expect(isPathOpenTo('knowledge', '/knowledge/anything')).toBe(true);
    expect(isPathOpenTo('knowledge', '/settings')).toBe(true);
    for (const path of [
      '/',
      '/dashboard',
      '/tasks',
      '/problems',
      '/team',
      '/knowledgebase',
      '/KNOWLEDGE',
      '/settings/company',
    ]) {
      expect(isPathOpenTo('knowledge', path)).toBe(false);
    }
  });

  test('where each one lands after the sign-in', () => {
    expect(homeOf('full')).toBe('/dashboard');
    expect(homeOf('knowledge')).toBe('/knowledge');
  });
});
