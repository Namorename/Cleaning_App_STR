import { PLAN_STEP_KINDS, QUALITY_THEME_CODES, THEME_STEP_KINDS } from '@str-ops/shared';
import { describe, expect, test } from 'vitest';

import {
  changeStep,
  groupByTheme,
  planSummary,
  proposeSteps,
  refusalsOf,
  themesInLivePlans,
  themesToAdd,
  wireStep,
  type DraftStep,
  type StepWords,
} from '../draft-model';
import type { PlacePlan } from '../schema';

const words: StepWords = (kind, theme) => ({
  title: `${kind} ${theme}`,
  title_i18n: { en: `${kind} ${theme}` },
});

function counter() {
  let n = 0;
  return () => `id-${(n += 1)}`;
}

function step(over: Partial<DraftStep> = {}): DraftStep {
  return {
    id: 'one',
    theme: 'heating',
    kind: 'repair',
    title: 'Fix',
    title_i18n: { en: 'Fix' },
    description: '',
    assignee_id: null,
    due_on: null,
    priority: 'normal',
    linked_problem_id: null,
    ...over,
  };
}

const roles: Record<string, string> = { tom: 'tech', boss: 'manager', anna: 'cleaner' };
const roleOf = (id: string) => roles[id] ?? null;

function placePlan(over: Partial<PlacePlan>): PlacePlan {
  return {
    id: 'plan',
    title: 'Plan',
    status: 'draft',
    rev: 1,
    created_at: '2026-11-06',
    launched_at: null,
    steps_total: 0,
    steps_closed: 0,
    themes: [],
    ...over,
  };
}

describe('the templates', () => {
  test('every theme proposes at least one step of a known kind', () => {
    for (const theme of QUALITY_THEME_CODES) {
      expect(THEME_STEP_KINDS[theme].length).toBeGreaterThan(0);
      expect(THEME_STEP_KINDS[theme].every((kind) => PLAN_STEP_KINDS.includes(kind))).toBe(true);
    }
  });
});

describe('proposeSteps', () => {
  test('gives a theme its template, with a fresh id for each step', () => {
    const steps = proposeSteps(['heating'], [], words, counter());

    expect(steps.map((one) => [one.id, one.kind, one.title])).toEqual([
      ['id-1', 'repair', 'repair heating'],
      ['id-2', 'inspection', 'inspection heating'],
    ]);
  });

  test('a repair leans on the live task of its theme and makes none', () => {
    const work = [{ problem_id: 'task', title: 'Cold radiators', status: 'open', theme: 'heating' }];

    const [repair, inspection] = proposeSteps(['heating'], work, words, counter());

    expect(repair).toMatchObject({
      linked_problem_id: 'task',
      title: 'Cold radiators',
      title_i18n: {},
    });
    expect(inspection.linked_problem_id).toBeNull();
  });

  test('a task of another theme changes nothing', () => {
    const work = [{ problem_id: 'task', title: 'Wi-Fi', status: 'open', theme: 'wifi' }];

    expect(proposeSteps(['heating'], work, words, counter())[0].linked_problem_id).toBeNull();
  });

  test('a theme this build does not know starts as a decision', () => {
    expect(proposeSteps(['brand_new'], [], words, counter()).map((one) => one.kind)).toEqual([
      'decision',
    ]);
  });
});

describe('changeStep', () => {
  test('changes the one step and leaves the list as it was', () => {
    const steps = [step(), step({ id: 'two' })];

    const next = changeStep(steps, 'two', { due_on: '2026-12-01' }, roleOf);

    expect(next[1].due_on).toBe('2026-12-01');
    expect(next[0]).toBe(steps[0]);
    expect(steps[1].due_on).toBeNull();
  });

  test('a new title drops the translations of the old one', () => {
    expect(changeStep([step()], 'one', { title: 'Other' }, roleOf)[0].title_i18n).toEqual({});
  });

  test('other changes keep them', () => {
    expect(changeStep([step()], 'one', { priority: 'high' }, roleOf)[0].title_i18n).toEqual({
      en: 'Fix',
    });
  });

  test('another kind sheds a person it does not allow', () => {
    const next = changeStep([step({ assignee_id: 'tom' })], 'one', { kind: 'decision' }, roleOf);

    expect(next[0].assignee_id).toBeNull();
  });

  test('and keeps one it allows', () => {
    const next = changeStep([step({ kind: 'decision', assignee_id: 'boss' })], 'one', { kind: 'purchase' }, roleOf);

    expect(next[0].assignee_id).toBe('boss');
  });

  test('only a repair leans on a task', () => {
    const next = changeStep([step({ linked_problem_id: 'task' })], 'one', { kind: 'decision' }, roleOf);

    expect(next[0].linked_problem_id).toBeNull();
  });
});

describe('groupByTheme', () => {
  test('keeps the order the themes first appear in', () => {
    const groups = groupByTheme([
      step({ id: 'a', theme: 'wifi' }),
      step({ id: 'b', theme: 'heating' }),
      step({ id: 'c', theme: 'wifi' }),
    ]);

    expect(groups.map((group) => [group.theme, group.steps.map((one) => one.id)])).toEqual([
      ['wifi', ['a', 'c']],
      ['heating', ['b']],
    ]);
  });
});

describe('planSummary', () => {
  test('says what a launch will make, and a linked repair makes no task', () => {
    expect(
      planSummary([
        step({ id: 'a' }),
        step({ id: 'b', linked_problem_id: 'task' }),
        step({ id: 'c', kind: 'inspection' }),
        step({ id: 'd', kind: 'purchase' }),
        step({ id: 'e', kind: 'decision' }),
      ]),
    ).toEqual({ tasks: 1, inspections: 1, requests: 1, decisions: 1, linked: 1 });
  });
});

describe('refusalsOf', () => {
  test('reads each step and why from the refusal', () => {
    const error = { details: '{"steps":[{"step":"one","reason":"date_missing"}]}' };

    expect(refusalsOf(error).get('one')).toBe('date_missing');
  });

  test.each([[null], [{}], [{ details: 'not json' }], [{ details: '{}' }]])(
    'finds nothing in %j',
    (error) => {
      expect(refusalsOf(error).size).toBe(0);
    },
  );
});

describe('themes already held', () => {
  test('a draft and a launched plan hold their themes, a finished one does not', () => {
    const held = themesInLivePlans([
      placePlan({ id: 'a', status: 'draft', themes: ['wifi'] }),
      placePlan({ id: 'b', status: 'launched', themes: ['heating'] }),
      placePlan({ id: 'c', status: 'done', themes: ['tv'] }),
      placePlan({ id: 'd', status: 'cancelled', themes: ['smell'] }),
    ]);

    expect([...held.entries()]).toEqual([
      ['wifi', 'a'],
      ['heating', 'b'],
    ]);
  });

  test('a theme goes into a draft once', () => {
    expect(themesToAdd(['wifi', 'tv'], [{ theme: 'wifi' }])).toEqual(['tv']);
  });
});

describe('wireStep', () => {
  test('sends what the function reads and nothing of the screen', () => {
    expect(Object.keys(wireStep(step())).sort()).toEqual(
      [
        'assignee_id',
        'description',
        'due_on',
        'id',
        'kind',
        'linked_problem_id',
        'priority',
        'theme',
        'title',
        'title_i18n',
      ].sort(),
    );
  });
});
