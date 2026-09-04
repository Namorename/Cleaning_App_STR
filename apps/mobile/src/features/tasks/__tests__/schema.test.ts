import { cleaningTaskSchema, earliestClaimableDate, isFree } from '../schema';

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
    property: { name: 'CZ - Nadrazni Apt 6' },
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
