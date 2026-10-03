import { Constants } from '@str-ops/shared';

import {
  PUSH_KINDS,
  isPushEnabled,
  kindsFor,
  pushPreferencesSchema,
  withPushChoice,
} from '../schema';

/**
 * Which pushes she wants is kept on the server as the list of the ones she
 * switched OFF (`push_preferences.muted`), so a kind added after launch
 * reaches everybody without moving any data. What the phone has to get right
 * is reading that list — including a kind a newer server knows and this build
 * does not — and saying a choice as the wanted value, never as a toggle.
 */

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

test('lists the push kinds in the order the owner approved them', () => {
  expect(PUSH_KINDS).toEqual([
    'cleaning_new',
    'cleaning_assigned',
    'cleaning_unassigned',
    'cleaning_cancelled',
    'cleaning_moved',
    'cleaning_window',
    'cleaning_free',
    'booking_cancelled_live',
    'problem_new',
    'chat_message',
    'daily_digest',
  ]);
});

test('the head technician is offered every kind, a new task among them', () => {
  expect(kindsFor('head_tech')).toEqual(PUSH_KINDS);
});

// Read off the enum: a role added later is checked here without a word.
const NOT_HEAD_TECH = Constants.public.Enums.app_role.filter((role) => role !== 'head_tech');

test.each(NOT_HEAD_TECH)('a %s is not offered a new task, and every other kind stays', (role) => {
  expect(kindsFor(role)).toEqual(PUSH_KINDS.filter((kind) => kind !== 'problem_new'));
});

test('the roles that are not offered a new task include the cleaner, the tech and the manager', () => {
  expect(NOT_HEAD_TECH).toEqual(expect.arrayContaining(['cleaner', 'tech', 'manager']));
});

test('a token without a role, or with one this build does not know, is not offered a new task', () => {
  const withoutNewTask = PUSH_KINDS.filter((kind) => kind !== 'problem_new');

  expect(kindsFor(null)).toEqual(withoutNewTask);
  expect(kindsFor('auditor')).toEqual(withoutNewTask);
});

test('a kind this build does not know is dropped, not thrown', () => {
  // Arrange: a newer server muted something this bundle has never heard of.
  const row = { profile_id: ME, muted: ['chat_message', 'cleaning_teleported'] };

  // Act
  const parsed = pushPreferencesSchema.parse(row);

  // Assert
  expect(parsed.muted).toEqual(['chat_message']);
});

test('a row without the list reads as nothing muted', () => {
  expect(pushPreferencesSchema.parse({ profile_id: ME }).muted).toEqual([]);
});

test('no row at all means every push is on', () => {
  expect(PUSH_KINDS.every((kind) => isPushEnabled(null, kind))).toBe(true);
  expect(PUSH_KINDS.every((kind) => isPushEnabled(undefined, kind))).toBe(true);
});

test('a muted kind is off and the others stay on', () => {
  const row = { profile_id: ME, muted: ['daily_digest' as const] };

  expect(isPushEnabled(row, 'daily_digest')).toBe(false);
  expect(isPushEnabled(row, 'chat_message')).toBe(true);
});

test('a choice is the wanted value: said twice, it lands where it did once', () => {
  // Act
  const once = withPushChoice(null, ME, 'daily_digest', false);
  const twice = withPushChoice(once, ME, 'daily_digest', false);

  // Assert
  expect(once).toEqual({ profile_id: ME, muted: ['daily_digest'] });
  expect(twice).toEqual(once);
});

test('switching a kind back on takes it off the list', () => {
  const muted = { profile_id: ME, muted: ['cleaning_new' as const, 'daily_digest' as const] };

  expect(withPushChoice(muted, ME, 'cleaning_new', true).muted).toEqual(['daily_digest']);
});

test('the list keeps the order of the kinds, whatever order she chose in', () => {
  const first = withPushChoice(null, ME, 'daily_digest', false);

  expect(withPushChoice(first, ME, 'cleaning_new', false).muted).toEqual([
    'cleaning_new',
    'daily_digest',
  ]);
});

test('a cached row no build can read is a start from everything on', () => {
  expect(withPushChoice({ broken: true }, ME, 'chat_message', false)).toEqual({
    profile_id: ME,
    muted: ['chat_message'],
  });
});
