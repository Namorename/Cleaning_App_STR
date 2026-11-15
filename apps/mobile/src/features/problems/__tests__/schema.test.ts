import type { ProblemCategory } from '../categories';
import {
  EMPTY_PROBLEM_DRAFT,
  asksForCategory,
  canEditProblem,
  draftOfProblem,
  draftWithCategory,
  groupProblems,
  hasTypedTitle,
  ownFixTaskId,
  problemDraftIssue,
  problemSchema,
  type Problem,
  type ProblemDraft,
} from '../schema';

const HOT_WATER: ProblemCategory = {
  id: '83ffda56-635c-4941-bedd-cb08b82e6675',
  name: 'Горячая вода',
  name_i18n: { en: 'Hot water', cs: 'Teplá voda' },
  synonyms: ['бойлер'],
  priority: 'high',
};

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
    property: { name: 'CZ - Nadrazni Apt 6', hostaway_unit_id: null, parent: null },
    fix_tasks: [],
    ...overrides,
  };
}

describe('problemDraftIssue', () => {
  const typed = (overrides: Partial<ProblemDraft>): ProblemDraft => ({
    ...EMPTY_PROBLEM_DRAFT,
    ...overrides,
  });

  test('insists on a title, like the server', () => {
    expect(problemDraftIssue(typed({ title: '   ' }))).toBe('titleRequired');
  });

  test('mirrors the server limits', () => {
    expect(problemDraftIssue(typed({ title: 'x'.repeat(201), priority: 'low' }))).toBe(
      'titleTooLong',
    );
    expect(problemDraftIssue(typed({ title: 'ok', description: 'y'.repeat(4001) }))).toBe(
      'descriptionTooLong',
    );
  });

  test('accepts a plain report', () => {
    expect(problemDraftIssue(typed({ title: 'Кран течёт', priority: 'high' }))).toBeNull();
  });

  test('a form that asks for a category needs one, and no title', () => {
    expect(problemDraftIssue(typed({}), true)).toBe('categoryRequired');
    expect(problemDraftIssue(typed({ categoryId: HOT_WATER.id, title: '' }), true)).toBeNull();
    expect(
      problemDraftIssue(typed({ categoryId: HOT_WATER.id, description: 'y'.repeat(4001) }), true),
    ).toBe('descriptionTooLong');
  });
});

describe('the category in the draft', () => {
  test('a form asks for a category while the catalogue is there and the title is not hers', () => {
    expect(asksForCategory(EMPTY_PROBLEM_DRAFT, [HOT_WATER], false)).toBe(true);
  });

  test('without a catalogue the title is typed, as before', () => {
    expect(asksForCategory(EMPTY_PROBLEM_DRAFT, null, false)).toBe(false);
  });

  test('once the title is hers the catalogue never takes it, not even emptied', () => {
    const typed = { ...EMPTY_PROBLEM_DRAFT, title: 'Кран' };
    expect(asksForCategory(typed, [HOT_WATER], true)).toBe(false);
    expect(asksForCategory({ ...typed, title: '' }, [HOT_WATER], true)).toBe(false);
  });

  test('a picked category stays asked for, catalogue or not', () => {
    const picked = draftWithCategory(EMPTY_PROBLEM_DRAFT, HOT_WATER, 'Hot water');
    expect(asksForCategory(picked, null, false)).toBe(true);
  });

  test('a typed report she corrects starts with a title of her own; one under a category does not', () => {
    expect(hasTypedTitle({ ...EMPTY_PROBLEM_DRAFT, title: 'Кран течёт' })).toBe(true);
    expect(hasTypedTitle(EMPTY_PROBLEM_DRAFT)).toBe(false);
    expect(hasTypedTitle(draftWithCategory(EMPTY_PROBLEM_DRAFT, HOT_WATER, 'Hot water'))).toBe(false);
  });

  test("picking takes the name she reads and the category's urgency", () => {
    const draft = { ...EMPTY_PROBLEM_DRAFT, description: 'кухня' };
    expect(draftWithCategory(draft, HOT_WATER, 'Hot water')).toEqual({
      title: 'Hot water',
      description: 'кухня',
      priority: 'high',
      categoryId: HOT_WATER.id,
    });
  });

  test("a category whose urgency this build does not know keeps the draft's, for the server", () => {
    const unknown = { ...HOT_WATER, priority: null };
    expect(draftWithCategory(EMPTY_PROBLEM_DRAFT, unknown, 'x').priority).toBe('normal');
  });

  test('a report filed under a category opens on it, named in her language', () => {
    const filed = problem({
      title: 'Горячая вода',
      title_i18n: { en: 'Hot water' },
      priority: 'high',
      category_id: HOT_WATER.id,
    });
    expect(draftOfProblem(filed, 'en')).toEqual({
      title: 'Hot water',
      description: '',
      priority: 'high',
      categoryId: HOT_WATER.id,
    });
  });

  test('a typed report opens as typed, with no category', () => {
    expect(draftOfProblem(problem({ title: 'Кран течёт' }), 'en')).toEqual({
      title: 'Кран течёт',
      description: '',
      priority: 'normal',
      categoryId: null,
    });
  });

  test('a saved row without the column reads as no category, a bad value as none', () => {
    const older = problem();
    expect(problemSchema.parse(older).category_id).toBeUndefined();
    expect(problemSchema.parse({ ...older, category_id: 'not a uuid' }).category_id).toBeNull();
  });
});

describe('canEditProblem', () => {
  test('the reporter edits while the report is open', () => {
    expect(canEditProblem(problem(), ME)).toBe(true);
  });

  // A task from a guest review has nobody who reported it (docs/reviews-to-tasks.md §2.5).
  test('a task nobody reported is read, and edited by nobody', () => {
    const parsed = problemSchema.parse({ ...problem(), reported_by: null });
    expect(parsed.reported_by).toBeNull();
    expect(canEditProblem(parsed, ME)).toBe(false);
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
