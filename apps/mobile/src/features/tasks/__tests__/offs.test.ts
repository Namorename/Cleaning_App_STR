import { cleaningOffs, isReasonRequired, reasonToSend } from '../offs';
import type { CleaningTask } from '../schema';

/**
 * Which ways off a job the phone offers (20261118120000): her decline before
 * the start, her interrupt after it, the office's cancel — mirroring what
 * decline_cleaning, interrupt_cleaning and cancel_cleaning take. The server
 * decides; this keeps the screen from offering what it would refuse.
 */

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const COLLEAGUE = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const PROBLEM_ID = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';

function task(overrides: Partial<CleaningTask> = {}): CleaningTask {
  return {
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    status: 'assigned',
    priority: 0,
    scheduled_date: '2026-11-18',
    due_at: null,
    assignee_id: ME,
    property_id: 412432,
    problem_id: null,
    property: null,
    time_from: null,
    time_to: null,
    guests_count: null,
    started_at: null,
    completed_at: null,
    is_parallel: false,
    type: 'cleaning',
    notes: null,
    title: null,
    title_i18n: {},
    ...overrides,
  };
}

describe('her own cleaning', () => {
  test.each(['assigned', 'accepted'] as const)('%s, not started, may be declined', (status) => {
    expect(cleaningOffs(task({ status }), ME, false)).toEqual(['decline']);
  });

  test.each(['in_progress', 'paused', 'blocked'] as const)(
    '%s, under way, may be interrupted',
    (status) => {
      expect(cleaningOffs(task({ status }), ME, false)).toEqual(['interrupt']);
    },
  );

  test.each(['unassigned', 'done', 'expired', 'cancelled'] as const)(
    '%s offers her nothing',
    (status) => {
      expect(cleaningOffs(task({ status }), ME, false)).toEqual([]);
    },
  );
});

test('a colleague’s cleaning is not hers to hand back', () => {
  expect(cleaningOffs(task({ assignee_id: COLLEAGUE }), ME, false)).toEqual([]);
  expect(cleaningOffs(task({ assignee_id: COLLEAGUE, status: 'in_progress' }), ME, false)).toEqual(
    [],
  );
});

test('a repair of a task is called off with its task, never here — the office’s cancel included', () => {
  const fix = task({ type: 'maintenance', problem_id: PROBLEM_ID });

  expect(cleaningOffs(fix, ME, true)).toEqual([]);
  expect(cleaningOffs({ ...fix, status: 'in_progress' }, ME, true)).toEqual([]);
});

test('a repair booked by hand, with no task behind it, is handed back like a cleaning', () => {
  expect(cleaningOffs(task({ type: 'maintenance' }), ME, false)).toEqual(['decline']);
});

// A copy saved by a build that did not ask for problem_id: whether it is a
// repair of a task is not known, so nothing is offered until the screen's read.
test('a row that does not say whether it is a repair offers nothing', () => {
  const { problem_id: _unknown, ...cached } = task();

  expect(cleaningOffs(cached, ME, true)).toEqual([]);
});

describe('the office', () => {
  test.each(['unassigned', 'assigned', 'accepted', 'in_progress', 'done', 'expired'] as const)(
    'may cancel a cleaning %s, anybody’s',
    (status) => {
      expect(cleaningOffs(task({ status, assignee_id: COLLEAGUE }), ME, true)).toEqual(['cancel']);
    },
  );

  test('is offered nothing on a cleaning already cancelled', () => {
    expect(cleaningOffs(task({ status: 'cancelled' }), ME, true)).toEqual([]);
  });

  test('a manager on her own cleaning may decline it and cancel it, in that order', () => {
    expect(cleaningOffs(task(), ME, true)).toEqual(['decline', 'cancel']);
  });
});

test('only an interrupt requires a reason', () => {
  expect(isReasonRequired('interrupt')).toBe(true);
  expect(isReasonRequired('decline')).toBe(false);
  expect(isReasonRequired('cancel')).toBe(false);
});

test.each([
  ['  Заболела  ', 'Заболела'],
  ['\nНет ключа\n', 'Нет ключа'],
  ['', null],
  ['   \n  ', null],
])('the reason %j is sent as %j', (typed, sent) => {
  expect(reasonToSend(typed)).toBe(sent);
});
