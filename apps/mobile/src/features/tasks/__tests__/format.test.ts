import {
  formatDeadlineTime,
  formatScheduledDate,
  formatWindow,
  propertyName,
  taskPlace,
  urgencyText,
} from '../format';
import type { CleaningTask } from '../schema';

/** A room of a multi-unit listing, as the query joins it. */
const ROOM = {
  name: '1 - 2109',
  address: 'Vinohradská 2109/10',
  hostaway_unit_id: 18007,
  effective_cleaner_notes: null,
  parent: { name: 'CZ - Vinohradska Royal Apt 1.3.5.7' },
};

function task(overrides: Partial<CleaningTask> = {}): CleaningTask {
  return {
    id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    status: 'unassigned',
    priority: 0,
    scheduled_date: '2026-11-10',
    due_at: null,
    assignee_id: null,
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

  test('a cleaning after a booking says whether the next guest comes that day', () => {
    expect(urgencyText(task({ reservation_id: 5001, priority: 0 }))).toBe('Заезда нет');
    expect(urgencyText(task({ reservation_id: 5001, priority: 1 }))).toBe('В этот день заезд');
  });

  test('an inspection, a midstay or a repair names its kind: no check-in is what it is about', () => {
    // A midstay's guest is in the flat; an inspection and a repair have nobody
    // to wait for, and every repair carries priority 0.
    expect(urgencyText(task({ type: 'inspection' }))).toBe('Осмотр');
    expect(urgencyText(task({ type: 'midstay', priority: 1 }))).toBe('Уборка в проживание');
    expect(urgencyText(task({ type: 'maintenance' }))).toBe('Обслуживание');
    expect(urgencyText(task({ type: 'maintenance', title: 'Заменить смеситель' }))).toBe(
      'Заменить смеситель',
    );
  });

  test('a job the office made by hand, with no booking behind it, claims nothing about a check-in', () => {
    // Priority 0 on it means nobody decided anything about arrivals — not that
    // nobody arrives. Named by its title, or else by its kind.
    expect(urgencyText(task({ reservation_id: null }))).toBe('Уборка');
    expect(urgencyText(task({ reservation_id: null, priority: 1 }))).toBe('Уборка');
    expect(urgencyText(task({ reservation_id: null, title: 'Генеральная уборка' }))).toBe(
      'Генеральная уборка',
    );
  });

  test('a row cached before the booking was asked for reads as it did before', () => {
    // The fixture has no `reservation_id` key, as such a row has none. No key
    // is "not known", not "no booking": the turnover she saw yesterday keeps
    // its check-in until the list refreshes.
    const cached = task({ priority: 1, due_at: null });

    expect('reservation_id' in cached).toBe(false);
    expect(urgencyText(cached)).toBe('В этот день заезд');
  });

  test('names an inspection or a midstay by the title the office gave it, as the panel does', () => {
    expect(urgencyText(task({ type: 'inspection', title: 'Проверить протечку' }))).toBe(
      'Проверить протечку',
    );
    // In her language when the office translated it.
    expect(
      urgencyText(
        task({ type: 'midstay', title: 'Fresh towels', title_i18n: { ru: 'Свежие полотенца' } }),
      ),
    ).toBe('Свежие полотенца');
    // A blank title is no title.
    expect(urgencyText(task({ type: 'inspection', title: '   ' }))).toBe('Осмотр');
  });
});

describe('taskPlace', () => {
  test('a cleaning on a listing is named by the listing itself', () => {
    const place = taskPlace(task());

    expect(place.building).toBe('CZ - Nadrazni Apt 6');
    expect(place.room).toBeNull();
  });

  test('a cleaning on a room names the building above the room', () => {
    // Arrange: the room the guest slept in. Its own name — "1 - 2109" — never
    // says which house it is in, and the cleaner drives to the house.
    const inRoom = task({ property: ROOM });

    // Act
    const place = taskPlace(inRoom);

    // Assert
    expect(place.building).toBe('CZ - Vinohradska Royal Apt 1.3.5.7');
    expect(place.room).toBe('1 - 2109');
  });

  test('carries the street she drives to', () => {
    expect(taskPlace(task({ property: ROOM })).address).toBe('Vinohradská 2109/10');
  });

  test('falls back to the id so a row is never nameless', () => {
    const place = taskPlace(task({ property: null }));

    expect(place.building).toBe('Объект 412432');
    expect(place.room).toBeNull();
    expect(place.address).toBeNull();
  });

  test('a part of a combined listing is a listing, not a room', () => {
    // `parent_id` carries two relationships and only one of them is a room.
    // A part of a combined listing has its own calendar and its own guests,
    // and putting its neighbour's name above it would simply be wrong.
    const part = taskPlace(
      task({
        property: {
          name: 'Žitná 12 ap. 313',
          address: 'Žitná 12',
          hostaway_unit_id: null,
          effective_cleaner_notes: null,
          parent: { name: 'Žitná 12 combined' },
        },
      }),
    );

    expect(part.building).toBe('Žitná 12 ap. 313');
    expect(part.room).toBeNull();
  });

  test('a task restored from the cache of an older build still names its flat', () => {
    // The disk cache is restored by JSON.parse and never passes through zod,
    // so a row written by the previous release arrives with the keys that
    // release knew — no `parent`, no `address` — and reading them off it must
    // degrade to the listing name rather than throw in the middle of a list.
    const cached = {
      ...task(),
      property: { name: 'CZ - Nadrazni Apt 6', effective_cleaner_notes: null },
    } as unknown as CleaningTask;

    const place = taskPlace(cached);

    expect(place.building).toBe('CZ - Nadrazni Apt 6');
    expect(place.room).toBeNull();
    expect(place.address).toBeNull();
  });
});

describe('propertyName', () => {
  test('uses the listing name when it is joined', () => {
    expect(propertyName(task())).toBe('CZ - Nadrazni Apt 6');
  });

  test('puts the building before the room where one line is all there is', () => {
    expect(propertyName(task({ property: ROOM }))).toBe(
      'CZ - Vinohradska Royal Apt 1.3.5.7 — 1 - 2109',
    );
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
