import { Constants } from '@str-ops/shared';

import { isTechnician, knownRole, roleOf, wordContextOf } from '../role';

/**
 * The role travels in the session's token, in `app_metadata`, which only the
 * server writes (manage-staff). `user_metadata` is the client's own and must
 * never decide what she is shown.
 */

test('reads the role the server wrote into app_metadata', () => {
  expect(roleOf({ app_metadata: { role: 'head_tech' } })).toBe('head_tech');
});

test('a token without a role, or no user at all, reads as no role', () => {
  expect(roleOf({ app_metadata: {} })).toBeNull();
  expect(roleOf(null)).toBeNull();
});

test('a role that is not text reads as no role', () => {
  expect(roleOf({ app_metadata: { role: 7 } })).toBeNull();
});

test('a role in user_metadata is never read', () => {
  // A variable, not a literal: the parameter only names app_metadata.
  const user = { app_metadata: {}, user_metadata: { role: 'head_tech' } };

  expect(roleOf(user)).toBeNull();
});

// Read off the enum: a role a migration adds is checked here without a word.
test.each(Constants.public.Enums.app_role)('%s is a role this build knows', (role) => {
  expect(knownRole(role)).toBe(role);
});

test('a role this build does not know, or none, reads as no role — the cleaner’s view', () => {
  expect(knownRole('auditor')).toBeNull();
  expect(knownRole('')).toBeNull();
  expect(knownRole(null)).toBeNull();
});

/**
 * The technician and the head technician have nothing to do with cleanings
 * (docs/tech-plan.md §0, §3): their tabs, their pushes and their words are a
 * technician's. Everyone else — the office included — sees the cleaner's.
 */
test.each([
  ['tech', true],
  ['head_tech', true],
  ['cleaner', false],
  ['manager', false],
  ['admin', false],
  [null, false],
] as const)('%s is a technician: %s', (role, expected) => {
  expect(isTechnician(role)).toBe(expected);
});

/** Both read the `_tech` variants (tech-plan §6); nobody else has a variant of their own. */
test.each([
  ['tech', 'tech'],
  ['head_tech', 'tech'],
  ['cleaner', undefined],
  ['manager', undefined],
  ['admin', undefined],
  [null, undefined],
] as const)('%s reads the words of context %s', (role, context) => {
  expect(wordContextOf(role)).toBe(context);
});
