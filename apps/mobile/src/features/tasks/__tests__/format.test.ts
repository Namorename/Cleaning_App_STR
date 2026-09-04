import {
  formatDeadlineTime,
  formatScheduledDate,
  formatWindow,
  propertyName,
  urgencyText,
} from '../format';
import type { CleaningTask } from '../schema';

function task(overrides: Partial<CleaningTask> = {}): CleaningTask {
  return {
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    status: 'unassigned',
    priority: 0,
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
    ...overrides,
  };
}

describe('formatScheduledDate', () => {
  test('reads the calendar date as a local day, not as midnight UTC', () => {
    // Arrange: a date that would slip to the 9th if parsed as a UTC instant
    // and rendered west of Greenwich.
    const scheduled = task({ scheduled_date: '2026-11-10' });

    // Act
    const formatted = formatScheduledDate(scheduled);

    // Assert
    expect(formatted).toContain('10');
    expect(formatted).not.toContain('9');
  });
});

describe('formatDeadlineTime', () => {
  test('returns null when the task has no deadline', () => {
    expect(formatDeadlineTime(task({ due_at: null }))).toBeNull();
  });

  test('renders a deadline as a bare time', () => {
    const formatted = formatDeadlineTime(task({ due_at: '2026-11-10T13:00:00+00:00' }));

    expect(formatted).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('urgencyText', () => {
  test('gives the check-in time and nothing else for a same-day turnover', () => {
    // Arrange: the next guest arrives on the day of the cleaning, at 13:00 UTC.
    const urgent = task({ priority: 1, due_at: '2026-11-10T13:00:00+00:00' });

    // Act
    const text = urgencyText(urgent);

    // Assert: the time is the only thing she has to plan around.
    expect(text).toMatch(/^В \d{2}:\d{2} заезд$/);
  });

  test('still says there is a check-in when the time is not known yet', () => {
    const text = urgencyText(task({ priority: 1, due_at: null }));

    expect(text).toBe('В этот день заезд');
  });

  test('says plainly that nobody is arriving', () => {
    expect(urgencyText(task({ priority: 0, due_at: null }))).toBe('Заезда нет');
  });
});

describe('propertyName', () => {
  test('uses the listing name when it is joined', () => {
    expect(propertyName(task())).toBe('CZ - Nadrazni Apt 6');
  });

  test('falls back to the id so a row is never nameless', () => {
    expect(propertyName(task({ property: null }))).toBe('Объект 412432');
  });
});

describe('formatWindow', () => {
  test('shows the window as two clock times', () => {
    // Postgres serialises a time with seconds; the cleaner does not need them.
    expect(formatWindow(task({ time_from: '10:00:00', time_to: '15:00:00' }))).toBe('10:00–15:00');
  });

  test('shows only the end when the start is unknown', () => {
    expect(formatWindow(task({ time_from: null, time_to: '15:00:00' }))).toBe('–15:00');
  });

  test('returns null when there is no window at all', () => {
    expect(formatWindow(task({ time_from: null, time_to: null }))).toBeNull();
  });
});
