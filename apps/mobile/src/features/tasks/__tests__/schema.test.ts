import {
  availableActions,
  calendarDay,
  canStartNow,
  cleaningTaskSchema,
  earliestClaimableDate,
  groupByDay,
  groupMyTasks,
  isFree,
  isRunning,
  startNotBefore,
  type CleaningTask,
} from '../schema';

describe('cleaningTaskSchema — the kinds the office creates, and its note', () => {
  /** A row as the server sends it, without the note column an older select left out. */
  function rowWithoutNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...Object.fromEntries(Object.entries(task()).filter(([key]) => key !== 'notes')),
      ...overrides,
    };
  }

  test('reads a midstay and an inspection, not only cleanings', () => {
    expect(cleaningTaskSchema.parse(rowWithoutNote({ type: 'midstay' })).type).toBe('midstay');
    expect(cleaningTaskSchema.parse(rowWithoutNote({ type: 'inspection' })).type).toBe(
      'inspection',
    );
  });

  test('keeps the note the office wrote, and a row read before the note came has none', () => {
    expect(cleaningTaskSchema.parse(rowWithoutNote({ notes: 'Полить цветы' })).notes).toBe(
      'Полить цветы',
    );
    expect(cleaningTaskSchema.parse(rowWithoutNote()).notes).toBeNull();
  });

  test('keeps the booking behind a task, its absence, and a row read before it was asked for', () => {
    expect(cleaningTaskSchema.parse(rowWithoutNote({ reservation_id: 5001 })).reservation_id).toBe(
      5001,
    );
    // Made by hand in the panel: no booking at all.
    expect(
      cleaningTaskSchema.parse(rowWithoutNote({ reservation_id: null })).reservation_id,
    ).toBeNull();
    // Cached by an older build: not known, which is not the same as none.
    expect(cleaningTaskSchema.parse(rowWithoutNote()).reservation_id).toBeUndefined();
  });
});

describe('canStartNow', () => {
  test('opens at the window start on the scheduled day, in local time', () => {
    // Arrange
    const cleaning = task({ scheduled_date: '2026-11-10', time_from: '10:00:00' });

    // Act & Assert
    expect(startNotBefore(cleaning)).toEqual(new Date(2026, 10, 10, 10, 0));
    expect(canStartNow(cleaning, new Date(2026, 10, 10, 9, 59))).toBe(false);
    expect(canStartNow(cleaning, new Date(2026, 10, 10, 10, 0))).toBe(true);
  });

  test('tomorrow cannot start today, whatever the hour', () => {
    const cleaning = task({ scheduled_date: '2026-11-11', time_from: '10:00:00' });

    expect(canStartNow(cleaning, new Date(2026, 10, 10, 23, 59))).toBe(false);
  });

  test('a window with no start opens at midnight', () => {
    const cleaning = task({ scheduled_date: '2026-11-10', time_from: null });

    expect(startNotBefore(cleaning)).toEqual(new Date(2026, 10, 10, 0, 0));
    expect(canStartNow(cleaning, new Date(2026, 10, 9, 23, 59))).toBe(false);
    expect(canStartNow(cleaning, new Date(2026, 10, 10, 0, 0))).toBe(true);
  });
});

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
    property: { name: 'CZ - Nadrazni Apt 6', effective_cleaner_notes: null },
    time_from: '10:00:00',
    time_to: '15:00:00',
    guests_count: null,
    started_at: null,
    completed_at: null,
    is_parallel: false,
    type: 'cleaning',
  };

  test('parses the terminal status the sweep writes', () => {
    // A status the database can produce must be parseable here, otherwise a
    // manager-facing screen would fail at the boundary rather than render it.
    expect(cleaningTaskSchema.parse(row).status).toBe('expired');
  });

  test('does not treat an expired task as free work', () => {
    expect(isFree(cleaningTaskSchema.parse(row))).toBe(false);
  });

  test('keeps the building a room belongs to', () => {
    // The cleaning stands on the room; the name of the house comes with it
    // through the join, and losing it at the boundary would leave the cleaner
    // with a room number and no address.
    const parsed = cleaningTaskSchema.parse({
      ...row,
      property: {
        name: '1 - 2109',
        address: 'Vinohradská 2109/10',
        hostaway_unit_id: 18007,
        effective_cleaner_notes: null,
        parent: { name: 'CZ - Vinohradska Royal Apt 1.3.5.7' },
      },
    });

    expect(parsed.property?.parent?.name).toBe('CZ - Vinohradska Royal Apt 1.3.5.7');
    expect(parsed.property?.address).toBe('Vinohradská 2109/10');
  });

  test('still parses a task cached before the building was joined', () => {
    // A row written to disk by the previous release has neither field.
    const parsed = cleaningTaskSchema.parse({
      ...row,
      property: { name: 'CZ - Nadrazni Apt 6', effective_cleaner_notes: null },
    });

    expect(parsed.property?.parent).toBeNull();
    expect(parsed.property?.address).toBeNull();
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
    property: {
      name: 'CZ - Nadrazni Apt 6',
      address: 'Nádražní 6',
      hostaway_unit_id: null,
      effective_cleaner_notes: null,
      parent: null,
    },
    time_from: '10:00:00',
    time_to: '15:00:00',
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

describe('calendarDay', () => {
  test('is the phone’s own date, in the shape scheduled_date uses', () => {
    // Late in the evening: an instant read as UTC would already be tomorrow
    // east of Greenwich and still yesterday west of it.
    expect(calendarDay(new Date(2026, 10, 10, 23, 59))).toBe('2026-11-10');
    expect(calendarDay(new Date(2026, 2, 8, 0, 1))).toBe('2026-03-08');
  });

  test('counts days forward and back across a month and a year', () => {
    expect(calendarDay(new Date(2026, 10, 30, 12, 0), 1)).toBe('2026-12-01');
    expect(calendarDay(new Date(2027, 0, 1, 12, 0), -1)).toBe('2026-12-31');
  });
});

describe('groupByDay', () => {
  const ON_10TH = 'a1b2c3d4-1111-4111-8111-a1b2c3d40001';
  const ON_11TH_URGENT = 'a1b2c3d4-2222-4222-8222-a1b2c3d40002';
  const ON_11TH = 'a1b2c3d4-3333-4333-8333-a1b2c3d40003';

  test('one section per planned day, the nearest first, each in the order the rows came', () => {
    // Arrange: as the server orders them — by day, then the same-day check-in first.
    const rows = [
      task({ id: ON_10TH, scheduled_date: '2026-11-10' }),
      task({ id: ON_11TH_URGENT, scheduled_date: '2026-11-11', priority: 1 }),
      task({ id: ON_11TH, scheduled_date: '2026-11-11' }),
    ];

    // Act
    const groups = groupByDay(rows);

    // Assert
    expect(groups.map((group) => [group.kind, group.key])).toEqual([
      ['day', '2026-11-10'],
      ['day', '2026-11-11'],
    ]);
    expect(groups[1].data.map((item) => item.id)).toEqual([ON_11TH_URGENT, ON_11TH]);
  });

  test('a day keeps its place whatever order the rows came in', () => {
    const groups = groupByDay([
      task({ id: ON_11TH, scheduled_date: '2026-11-11' }),
      task({ id: ON_10TH, scheduled_date: '2026-11-10' }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(['2026-11-10', '2026-11-11']);
  });

  test('no rows, no sections: an empty list is said by the list, not by an empty heading', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('groupMyTasks', () => {
  test('puts every running cleaning first, in a section of its own, whatever its day', () => {
    // Arrange: two started on one floor (parallel start), one of them still
    // yesterday's, and two more ahead.
    const running1 = task({
      id: 'a1b2c3d4-1111-4111-8111-a1b2c3d40001',
      status: 'in_progress',
      scheduled_date: '2026-11-09',
    });
    const today = task({ id: 'a1b2c3d4-2222-4222-8222-a1b2c3d40002', status: 'assigned' });
    const running2 = task({ id: 'a1b2c3d4-3333-4333-8333-a1b2c3d40003', status: 'in_progress' });
    const tomorrow = task({
      id: 'a1b2c3d4-4444-4444-8444-a1b2c3d40004',
      status: 'accepted',
      scheduled_date: '2026-11-11',
    });

    // Act
    const groups = groupMyTasks([running1, today, running2, tomorrow]);

    // Assert: both running ones first, in their own order; the rest by day.
    expect(groups.map((group) => [group.kind, group.key])).toEqual([
      ['running', 'running'],
      ['day', '2026-11-10'],
      ['day', '2026-11-11'],
    ]);
    expect(groups[0].data.map((item) => item.id)).toEqual([running1.id, running2.id]);
    expect(groups[1].data.map((item) => item.id)).toEqual([today.id]);
  });

  test('omits the running section rather than showing a heading with nothing under it', () => {
    const groups = groupMyTasks([task({ status: 'assigned' })]);

    expect(groups.map((group) => group.kind)).toEqual(['day']);
  });
});

describe('availableActions', () => {
  const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  test('free work is taken, not accepted or started', () => {
    expect(availableActions(task({ status: 'unassigned', assignee_id: null }), ME)).toEqual([
      'claim',
    ]);
  });

  test('her assigned cleaning can be accepted, and started without it', () => {
    // Accepting is a signal to the office, not a lock: a cleaner who forgot to
    // tap it must still be able to work at the door (owner's decision 5).
    expect(availableActions(task({ status: 'assigned' }), ME)).toEqual(['accept', 'start']);
  });

  test('once accepted, starting is what is left', () => {
    expect(availableActions(task({ status: 'accepted' }), ME)).toEqual(['start']);
  });

  test('under way, only the finish', () => {
    expect(availableActions(task({ status: 'in_progress' }), ME)).toEqual(['finish']);
  });

  test("nothing on a colleague's job, accepted or not", () => {
    const colleague = 'a1b2c3d4-2222-4222-8222-a1b2c3d40002';

    expect(availableActions(task({ status: 'assigned', assignee_id: colleague }), ME)).toEqual([]);
    expect(availableActions(task({ status: 'accepted', assignee_id: colleague }), ME)).toEqual([]);
  });

  test('nothing on a finished, cancelled or expired job', () => {
    expect(availableActions(task({ status: 'done' }), ME)).toEqual([]);
    expect(availableActions(task({ status: 'cancelled' }), ME)).toEqual([]);
    expect(availableActions(task({ status: 'expired' }), ME)).toEqual([]);
  });
});

describe('isRunning', () => {
  test('is true only for work in progress', () => {
    expect(isRunning(task({ status: 'in_progress' }))).toBe(true);
    expect(isRunning(task({ status: 'assigned' }))).toBe(false);
    expect(isRunning(task({ status: 'done' }))).toBe(false);
  });
});
