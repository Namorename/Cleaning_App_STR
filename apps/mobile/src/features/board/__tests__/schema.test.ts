import {
  CLEANER_ANNA,
  HEAD_TECH,
  STAFF,
  TECH_GONE,
  TECH_IVAN,
  TECH_OLGA,
  boardProblem,
  repair,
} from '@/testing/board-fixtures';

import {
  ANY_ASSIGNEE,
  NO_ASSIGNEE,
  activeTechnicians,
  boardProblemListSchema,
  boardReadCutSchema,
  boardSections,
  canAssign,
  canTakeOff,
  cutBoard,
  filterBoard,
  liveRepair,
  staffListSchema,
  type BoardProblem,
  type BoardRead,
} from '../schema';

/**
 * The head technician's board, as data (docs/tech-plan.md §3.4, §4): every
 * task of the company with its live repair — who holds it and for which day —
 * read through `readCached` like every list the phone keeps on disk, and the
 * filters by status and by person.
 */

const OTHER = 'd1e2f3a4-1111-4111-8111-d1e2f3a40002';
const THIRD = 'd1e2f3a4-1111-4111-8111-d1e2f3a40003';
const FOURTH = 'd1e2f3a4-1111-4111-8111-d1e2f3a40004';

describe('the reader', () => {
  test('a row saved in an older shape reads with defaults, not undefined', () => {
    // Arrange: no archive stamp, no house, a repair without its day and hours.
    const saved = [
      {
        id: OTHER,
        property_id: 412432,
        title: 'Нет горячей воды',
        priority: 'high',
        status: 'assigned',
        created_at: '2026-10-05T08:00:00+00:00',
        property: { name: '1 - 2109' },
        fix_tasks: [{ id: 'b1c2d3e4-2222-4222-8222-b1c2d3e40009', status: 'assigned' }],
      },
    ];

    // Act
    const [row] = boardProblemListSchema.parse(saved);

    // Assert
    expect(row.archived_at).toBeNull();
    expect(row.property).toEqual({
      name: '1 - 2109',
      hostaway_unit_id: null,
      timezone: null,
      parent: null,
    });
    expect(row.fix_tasks[0]).toEqual({
      id: 'b1c2d3e4-2222-4222-8222-b1c2d3e40009',
      type: 'maintenance',
      assignee_id: null,
      status: 'assigned',
      scheduled_date: null,
      time_from: null,
      time_to: null,
    });
  });

  test('a row with no repairs and no listing reads as none of either', () => {
    const [row] = boardProblemListSchema.parse([
      {
        id: OTHER,
        property_id: null,
        title: 'Сломан замок',
        priority: 'normal',
        status: 'open',
        created_at: '2026-10-05T08:00:00+00:00',
      },
    ]);

    expect(row.fix_tasks).toEqual([]);
    expect(row.property).toBeNull();
  });

  // The planned day (20261126130000) is no key of a board an older build saved.
  test('a row saved before the planned day reads as nothing planned', () => {
    const [saved, planned] = boardProblemListSchema.parse([
      {
        id: OTHER,
        property_id: 412432,
        title: 'Нет горячей воды',
        priority: 'high',
        status: 'open',
        created_at: '2026-10-05T08:00:00+00:00',
      },
      {
        id: THIRD,
        property_id: 412432,
        title: 'Сломан замок',
        priority: 'normal',
        status: 'open',
        created_at: '2026-10-05T08:00:00+00:00',
        due_on: '2026-12-04',
      },
    ]);

    expect(saved.due_on).toBeNull();
    expect(planned.due_on).toBe('2026-12-04');
  });

  test('a person without a name, or of a role this build does not know, is still read', () => {
    const [person] = staffListSchema.parse([
      { id: TECH_IVAN, full_name: null, role: 'plumber', is_active: true },
    ]);

    expect(person).toEqual({ id: TECH_IVAN, full_name: null, role: 'plumber', is_active: true });
  });
});

describe('the live repair', () => {
  test('is the repair that is neither done, cancelled nor expired', () => {
    const live = repair({ id: 'b1c2d3e4-2222-4222-8222-b1c2d3e40002', status: 'accepted' });
    const problem = boardProblem({
      status: 'assigned',
      fix_tasks: [repair({ status: 'cancelled' }), live, repair({ status: 'done' })],
    });

    expect(liveRepair(problem)).toEqual(live);
  });

  test('is none when every attempt is over', () => {
    const problem = boardProblem({ fix_tasks: [repair({ status: 'expired' })] });

    expect(liveRepair(problem)).toBeNull();
  });

  test('is never a job of another kind that carries the task', () => {
    const problem = boardProblem({ fix_tasks: [repair({ type: 'cleaning' })] });

    expect(liveRepair(problem)).toBeNull();
  });
});

describe('what the head technician may do to a task', () => {
  test('an open task with nobody on it can be handed out, not taken off', () => {
    const problem = boardProblem();

    expect(canAssign(problem)).toBe(true);
    expect(canTakeOff(problem)).toBe(false);
  });

  test('a task whose repair somebody holds can be taken off, not handed out again', () => {
    const problem = boardProblem({ status: 'assigned', fix_tasks: [repair()] });

    expect(canAssign(problem)).toBe(false);
    expect(canTakeOff(problem)).toBe(true);
  });

  test('a repair a cleaner holds can be taken off too (decision 17)', () => {
    const problem = boardProblem({
      status: 'in_progress',
      fix_tasks: [repair({ assignee_id: CLEANER_ANNA, status: 'in_progress' })],
    });

    expect(canTakeOff(problem)).toBe(true);
  });

  test.each(['resolved', 'cancelled'] as const)('a %s task is the manager’s alone', (status) => {
    const problem = boardProblem({ status });

    expect(canAssign(problem)).toBe(false);
    expect(canTakeOff(problem)).toBe(false);
  });

  test('a task without a listing is not handed out: the server cannot schedule it', () => {
    expect(canAssign(boardProblem({ property_id: null, property: null }))).toBe(false);
  });

  test('an archived task is not handed out', () => {
    expect(canAssign(boardProblem({ archived_at: '2026-10-06T08:00:00+00:00' }))).toBe(false);
  });
});

describe('the filters', () => {
  const open = boardProblem({ id: OTHER });
  const ivans = boardProblem({ id: THIRD, status: 'assigned', fix_tasks: [repair()] });
  const olgas = boardProblem({
    id: FOURTH,
    status: 'in_progress',
    fix_tasks: [repair({ assignee_id: TECH_OLGA, status: 'in_progress' })],
  });
  const resolved = boardProblem({
    id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40005',
    status: 'resolved',
    fix_tasks: [repair({ status: 'done' })],
  });
  const cancelled = boardProblem({
    id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40006',
    status: 'cancelled',
  });
  const archived = boardProblem({
    id: 'd1e2f3a4-1111-4111-8111-d1e2f3a40007',
    archived_at: '2026-10-06T08:00:00+00:00',
  });
  const all = [open, ivans, olgas, resolved, cancelled, archived];
  const ids = (problems: readonly { id: string }[]) => problems.map((problem) => problem.id);

  test('«Все» is every task out of the archive, closed ones too', () => {
    expect(ids(filterBoard(all, { status: 'all', assignee: ANY_ASSIGNEE }))).toEqual(
      ids([open, ivans, olgas, resolved, cancelled]),
    );
  });

  test.each([
    ['open', 'open'],
    ['assigned', 'ivans'],
    ['in_progress', 'olgas'],
    ['resolved', 'resolved'],
  ] as const)('«%s» is the tasks of that status alone', (status, expected) => {
    const named = { open, ivans, olgas, resolved };

    expect(ids(filterBoard(all, { status, assignee: ANY_ASSIGNEE }))).toEqual([named[expected].id]);
  });

  test('the archive is its own filter, and only there', () => {
    expect(ids(filterBoard(all, { status: 'archived', assignee: ANY_ASSIGNEE }))).toEqual([
      archived.id,
    ]);
    expect(ids(filterBoard(all, { status: 'open', assignee: ANY_ASSIGNEE }))).not.toContain(
      archived.id,
    );
  });

  test('a person is the tasks whose live repair he holds', () => {
    expect(
      ids(filterBoard(all, { status: 'all', assignee: { kind: 'person', id: TECH_IVAN } })),
    ).toEqual([ivans.id]);
  });

  test('«Без исполнителя» is the live tasks nobody holds, not the closed ones', () => {
    expect(ids(filterBoard(all, { status: 'all', assignee: NO_ASSIGNEE }))).toEqual([open.id]);
  });

  test('the two filters together', () => {
    expect(
      filterBoard(all, { status: 'open', assignee: { kind: 'person', id: TECH_OLGA } }),
    ).toEqual([]);
  });

  test('live tasks come first, the closed ones under their own heading', () => {
    const sections = boardSections([resolved, open, cancelled, ivans]);

    expect(sections.map((section) => [section.key, ids(section.data)])).toEqual([
      ['active', [open.id, ivans.id]],
      ['closed', [resolved.id, cancelled.id]],
    ]);
  });

  test('an empty list has no sections', () => {
    expect(boardSections([])).toEqual([]);
  });

  // The owner, 2026-11-26: the live part is the technicians' queue — the planned day, else the
  // day made; then the level; then the older first. Ordered after the cut, which keeps the newest.
  test('the live tasks stand in the queue’s order; the closed keep theirs', () => {
    const id = (n: number) => `d1e2f3a4-2222-4222-8222-${String(n).padStart(12, '0')}`;
    const planned = boardProblem({
      id: id(1),
      created_at: '2026-11-24T08:00:00+00:00',
      due_on: '2026-12-04',
    });
    const critical = boardProblem({
      id: id(2),
      created_at: '2026-11-23T08:00:00+00:00',
      priority: 'high',
      critical: true,
    });
    const newer = boardProblem({ id: id(3), created_at: '2026-11-20T10:00:00+00:00' });
    const older = boardProblem({ id: id(4), created_at: '2026-11-20T08:00:00+00:00' });
    const dueEarlier = boardProblem({
      id: id(5),
      created_at: '2026-11-22T08:00:00+00:00',
      priority: 'high',
      due_on: '2026-11-20',
    });
    const closedNewer = boardProblem({
      id: id(6),
      status: 'resolved',
      created_at: '2026-11-25T08:00:00+00:00',
    });
    const closedOlder = boardProblem({
      id: id(7),
      status: 'cancelled',
      created_at: '2026-11-19T08:00:00+00:00',
    });

    // As read: newest first.
    const sections = boardSections([
      closedNewer,
      planned,
      critical,
      newer,
      older,
      closedOlder,
      dueEarlier,
    ]);

    expect(sections.map((section) => [section.key, ids(section.data)])).toEqual([
      ['active', [dueEarlier.id, older.id, newer.id, critical.id, planned.id]],
      ['closed', [closedNewer.id, closedOlder.id]],
    ]);
  });

  test('within a day the property by name: live in the queue, closed and archived alike', () => {
    const id = (n: number) => `d1e2f3a4-3333-4333-8333-${String(n).padStart(12, '0')}`;
    const at = (name: string) => ({ name, hostaway_unit_id: null, timezone: null, parent: null });
    const day = '2026-11-20T08:00:00+00:00';
    const liveB = boardProblem({ id: id(1), created_at: day, property: at('Beta 10') });
    const liveA = boardProblem({ id: id(2), created_at: day, property: at('beta 2') });
    const closedB = boardProblem({
      id: id(3),
      status: 'resolved',
      created_at: day,
      property: at('B'),
    });
    const closedA = boardProblem({
      id: id(4),
      status: 'resolved',
      created_at: day,
      property: at('A'),
    });

    const sections = boardSections([liveB, closedB, liveA, closedA], { language: 'en' });
    expect(sections.map((section) => [section.key, ids(section.data)])).toEqual([
      ['active', [liveA.id, liveB.id]],
      ['closed', [closedA.id, closedB.id]],
    ]);

    const [archive] = boardSections([liveB, liveA], { isQueue: false, language: 'en' });
    expect(ids(archive.data)).toEqual([liveA.id, liveB.id]);
  });

  test('the archive keeps the order of its pages, newest first', () => {
    const newer = boardProblem({ id: OTHER, archived_at: '2026-11-25T08:00:00+00:00' });
    const older = boardProblem({
      id: THIRD,
      archived_at: '2026-11-20T08:00:00+00:00',
      created_at: '2026-09-01T08:00:00+00:00',
    });

    const [section] = boardSections([newer, older], { isQueue: false });

    expect(ids(section.data)).toEqual([OTHER, THIRD]);
  });
});

// What the reads said of the cut is kept apart from the rows (`boardKeys.cut`):
// read back as it was said, and a part it does not name is not said cut.
describe('the cut as the phone keeps it', () => {
  test('read back as each read said it', () => {
    expect(boardReadCutSchema.parse({ isOpenCut: false, isClosedCut: true })).toEqual({
      isOpenCut: false,
      isClosedCut: true,
    });
  });

  test('a part it does not name is not said cut', () => {
    expect(boardReadCutSchema.parse({ isClosedCut: true })).toEqual({
      isOpenCut: false,
      isClosedCut: true,
    });
  });
});

// The board reads one more of each part than it shows (api.ts): the one more
// says the part was cut (the verification review of f3217a7..c466bf5, item 3).
describe('the board cut to its limits', () => {
  const LIMITS = { open: 2, closed: 1 };
  const ids = (problems: readonly { id: string }[]) => problems.map((problem) => problem.id);

  /** The board as its reads answered; neither said cut unless told. */
  function read(problems: BoardProblem[], cut: Partial<BoardRead> = {}): BoardRead {
    return { problems, isOpenCut: false, isClosedCut: false, ...cut };
  }

  function numbered(count: number, status: BoardProblem['status'], from: number): BoardProblem[] {
    return Array.from({ length: count }, (_, index) =>
      boardProblem({
        id: `d1e2f3a4-2222-4222-8222-${String(from + index).padStart(12, '0')}`,
        status,
      }),
    );
  }

  test('one more open than shown: the newest open ones stay, and the open part is said cut', () => {
    const live = numbered(3, 'open', 0);
    const closed = numbered(1, 'resolved', 10);

    const cut = cutBoard(read([...live, ...closed]), LIMITS);

    expect(ids(cut.problems)).toEqual([live[0].id, live[1].id, closed[0].id]);
    expect(cut.isOpenCut).toBe(true);
    expect(cut.isClosedCut).toBe(false);
  });

  test('one more closed than shown: every open one stays, and the closed part is said cut', () => {
    const live = numbered(1, 'in_progress', 0);
    const closed = [...numbered(1, 'resolved', 10), ...numbered(1, 'cancelled', 11)];

    const cut = cutBoard(read([...live, ...closed]), LIMITS);

    expect(ids(cut.problems)).toEqual([live[0].id, closed[0].id]);
    expect(cut.isOpenCut).toBe(false);
    expect(cut.isClosedCut).toBe(true);
  });

  test('exactly at the limits, nothing is cut', () => {
    const rows = [...numbered(2, 'assigned', 0), ...numbered(1, 'resolved', 10)];

    const cut = cutBoard(read(rows), LIMITS);

    expect(cut.problems).toEqual(rows);
    expect(cut.isOpenCut).toBe(false);
    expect(cut.isClosedCut).toBe(false);
  });

  // A task closed between the two reads is handed back once (api.ts): the
  // closed part is then at its limit although its read came back with one
  // more. The read says so, and the board says so.
  test.each([
    ['the closed', { isClosedCut: true }, false, true],
    ['the open', { isOpenCut: true }, true, false],
  ] as const)(
    '%s read said cut is said cut, though what is handed back is at the limit',
    (_, said, isOpenCut, isClosedCut) => {
      const rows = [...numbered(2, 'assigned', 0), ...numbered(1, 'resolved', 10)];

      const cut = cutBoard(read(rows, said), LIMITS);

      expect(cut.problems).toEqual(rows);
      expect(cut.isOpenCut).toBe(isOpenCut);
      expect(cut.isClosedCut).toBe(isClosedCut);
    },
  );
});

describe('the technicians he hands work to', () => {
  test('are the active technicians and himself, never a cleaner or a switched-off one', () => {
    const offered = activeTechnicians(STAFF).map((person) => person.id);

    expect(offered).toEqual([TECH_IVAN, TECH_OLGA, HEAD_TECH]);
    expect(offered).not.toContain(CLEANER_ANNA);
    expect(offered).not.toContain(TECH_GONE);
  });
});
