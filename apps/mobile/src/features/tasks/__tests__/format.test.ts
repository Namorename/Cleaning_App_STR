import { formatDeadline, formatScheduledDate, propertyName, urgencyText } from '../format';
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
    property: { name: 'CZ - Nadrazni Apt 6' },
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

describe('formatDeadline', () => {
  test('returns null when the task has no deadline', () => {
    expect(formatDeadline(task({ due_at: null }))).toBeNull();
  });

  test('renders a deadline as a time with a prefix', () => {
    const formatted = formatDeadline(task({ due_at: '2026-11-10T13:00:00+00:00' }));

    expect(formatted).toMatch(/^до \d{2}:\d{2}$/);
  });
});

describe('urgencyText', () => {
  test('spells out why a same-day turnover is urgent and by when', () => {
    // Arrange: the next guest arrives on the day of the cleaning, at 13:00 UTC.
    const urgent = task({ priority: 1, due_at: '2026-11-10T13:00:00+00:00' });

    // Act
    const text = urgencyText(urgent);

    // Assert: the reason and the deadline, not an abstract badge.
    expect(text).toContain('Срочно');
    expect(text).toContain('заезжает следующий гость');
    expect(text).toMatch(/успеть до \d{2}:\d{2}/);
  });

  test('states the reason even when the deadline is not known yet', () => {
    const text = urgencyText(task({ priority: 1, due_at: null }));

    expect(text).toContain('заезжает следующий гость');
    expect(text).not.toContain('успеть');
  });

  test('says plainly that an ordinary cleaning has nobody arriving', () => {
    const text = urgencyText(task({ priority: 0, due_at: null }));

    expect(text).toContain('Обычная уборка');
    expect(text).toContain('заезда нет');
    expect(text).not.toContain('Срочно');
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
