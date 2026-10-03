import { roleOf } from '../role';

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
