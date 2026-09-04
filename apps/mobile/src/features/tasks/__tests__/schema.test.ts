import {
  cleaningTaskSchema,
  earliestClaimableDate,
  groupMyTasks,
  isFree,
  isRunning,
  type CleaningTask,
} from '../schema';

describe('earliestClaimableDate', () => {
  test('allows yesterday, so a cleaning caught up in the morning is still takeable', () => {
    // Arrange
    const now = new Date(2026, 10, 10, 9, 30);

    // Act
    const earliest = earliestClaimableDate(now);

    // Assert
    expect(earliest).toBe('2026-11-09');
  });

  test('steps back across a month boundary', () => {
    expect(earliestClaimableDate(new Date(2026, 11, 1, 0, 5))).toBe('2026-11-30');
  });

  test('steps back across a year boundary', () => {
    expect(earliestClaimableDate(new Date(2027, 0, 1, 23, 59))).toBe('2026-12-31');
  });

  test('pads month and day to the shape scheduled_date uses', () => {
    expect(earliestClaimableDate(new Date(2026, 2, 8, 12, 0))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('cleaningTaskSchema', () => {
  const row = {
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    status: 'expired',
    priority: 1,
    scheduled_date: '2026-11-10',
    due_at: null,
    assignee_id: null,
    property_id: 412432,
    property: { name: 'CZ - Nadrazni Apt 6', cleaner_notes: null },
    time_from: '10:00:00',
    time_to: '15:00:00',
    guests_count: null,
    started_at: null,
    completed_at: null,
    is_parallel: false,
  };

  test('parses the terminal status the sweep writes', () => {
    // A status the database can produce must be parseable here, otherwise a
    // manager-facing screen would fail at the boundary rather than render it.
    expect(cleaningTaskSchema.parse(row).status).toBe('expired');
  });

  test('does not treat an expired task as free work', () => {
    expect(isFree(cleaningTaskSchema.parse(row))).toBe(false);
  });
});

function task(overrides: Partial<CleaningTask> = {}): CleaningTask {
  return {
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    status: 'assigned',
    priority: 0,
    scheduled_date: '2026-11-10',
    due_at: null,
    assignee_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    property_id: 412432,
    property: { name: 'CZ - Nadrazni Apt 6', cleaner_notes: null },
    time_from: '10:00:00',
    time_to: '15:00:00',
    guests_count: null,
    started_at: null,
    completed_at: null,
    is_parallel: false,
    ...overrides,
  };
}

describe('groupMyTasks', () => {
  test('puts every running cleaning first, so she can switch between them', () => {
    // Arrange: three flats on one floor, two of them already started.
    const running1 = task({ id: 'a1b2c3d4-1111-4111-8111-a1b2c3d40001', status: 'in_progress' });
    const upcoming = task({ id: 'a1b2c3d4-2222-4222-8222-a1b2c3d40002', status: 'assigned' });
    const running2 = task({ id: 'a1b2c3d4-3333-4333-8333-a1b2c3d40003', status: 'in_progress' });

    // Act
    const groups = groupMyTasks([upcoming, running1, running2]);

    // Assert: both running tasks are in the first group, in their own order.
    expect(groups.map((group) => group.key)).toEqual(['running', 'upcoming']);
    expect(groups[0].data.map((item) => item.id)).toEqual([running1.id, running2.id]);
    expect(groups[1].data.map((item) => item.id)).toEqual([upcoming.id]);
  });

  test('omits an empty group rather than showing a heading with nothing under it', () => {
    const groups = groupMyTasks([task({ status: 'assigned' })]);

    expect(groups.map((group) => group.key)).toEqual(['upcoming']);
  });
});

describe('isRunning', () => {
  test('is true only for work in progress', () => {
    expect(isRunning(task({ status: 'in_progress' }))).toBe(true);
    expect(isRunning(task({ status: 'assigned' }))).toBe(false);
    expect(isRunning(task({ status: 'done' }))).toBe(false);
  });
});
