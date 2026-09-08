import {
  canEditProblem,
  groupProblems,
  ownFixTaskId,
  problemDraftIssue,
  problemSchema,
  type Problem,
} from '../schema';

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const TECH = 'a1b2c3d4-2222-4222-8222-a1b2c3d40002';

function problem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: 'c8000001-0000-4000-8000-000000000001',
    property_id: 412432,
    task_id: null,
    reported_by: ME,
    title: 'Кран течёт',
    description: null,
    priority: 'normal',
    status: 'open',
    resolved_at: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: '2026-11-10T08:05:00+00:00',
    property: { name: 'CZ - Nadrazni Apt 6' },
    fix_tasks: [],
    ...overrides,
  };
}

describe('problemDraftIssue', () => {
  test('insists on a title, like the server', () => {
    expect(problemDraftIssue({ title: '   ', description: '', priority: 'normal' })).toBe(
      'titleRequired',
    );
  });

  test('mirrors the server limits', () => {
    expect(problemDraftIssue({ title: 'x'.repeat(201), description: '', priority: 'low' })).toBe(
      'titleTooLong',
    );
    expect(
      problemDraftIssue({ title: 'ok', description: 'y'.repeat(4001), priority: 'low' }),
    ).toBe('descriptionTooLong');
  });

  test('accepts a plain report', () => {
    expect(problemDraftIssue({ title: 'Кран течёт', description: '', priority: 'high' })).toBeNull();
  });
});

describe('canEditProblem', () => {
  test('the reporter edits while the report is open', () => {
    expect(canEditProblem(problem(), ME)).toBe(true);
  });

  test('nobody edits once it has been picked up', () => {
    expect(canEditProblem(problem({ status: 'assigned' }), ME)).toBe(false);
  });

  test('a colleague never edits', () => {
    expect(canEditProblem(problem(), TECH)).toBe(false);
  });
});

describe('ownFixTaskId', () => {
  test('finds the live task the reader holds, ignoring cancelled attempts', () => {
    const row = problem({
      fix_tasks: [
        { id: 'a1b2c3d4-1111-4111-8111-a1b2c3d40001', assignee_id: TECH, status: 'cancelled' },
        { id: 'a1b2c3d4-3333-4333-8333-a1b2c3d40003', assignee_id: TECH, status: 'assigned' },
      ],
    });

    expect(ownFixTaskId(row, TECH)).toBe('a1b2c3d4-3333-4333-8333-a1b2c3d40003');
    expect(ownFixTaskId(row, ME)).toBeNull();
  });
});

describe('groupProblems', () => {
  test('keeps live reports above closed ones and drops empty groups', () => {
    const open = problem();
    const resolved = problem({ id: 'c8000001-0000-4000-8000-000000000002', status: 'resolved' });

    expect(groupProblems([resolved, open]).map((group) => group.key)).toEqual(['active', 'closed']);
    expect(groupProblems([open]).map((group) => group.key)).toEqual(['active']);
  });
});

describe('problemSchema', () => {
  test('parses a row straight from an RPC, without joins', () => {
    const { property, fix_tasks, ...bare } = problem();
    void property;
    void fix_tasks;

    const parsed = problemSchema.parse(bare);

    expect(parsed.fix_tasks).toEqual([]);
    expect(parsed.property).toBeUndefined();
  });
});
