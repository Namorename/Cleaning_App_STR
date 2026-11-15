import {
  PROBLEM_LEVELS,
  TONE_COLORS,
  byUrgencyFirst,
  problemLevel,
  problemLevelTone,
  storedUrgency,
} from '@str-ops/shared';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet, Text, type ViewStyle } from 'react-native';
import { z } from 'zod';

import { BoardCard } from '@/features/board/board-card';
import { TaskCard } from '@/features/tasks/task-card';
import type { CleaningTask } from '@/features/tasks/schema';
import { boardProblem } from '@/testing/board-fixtures';

import { reportProblem, updateProblem } from '../api';
import { PriorityChip } from '../category-picker';
import { ProblemCard } from '../problem-card';
import { ProblemForm } from '../problem-form';
import {
  EMPTY_PROBLEM_DRAFT,
  draftOfProblem,
  problemListSchema,
  type Problem,
  type ProblemDraft,
} from '../schema';

/**
 * The level above high, «Критическая» (owner, 2026-11-15; 20261115090000). It
 * is stored as priority `high` with the flag `critical`: what a phone of an
 * older build parses stays within its three values, and the new one reads the
 * flag, ranks it above high and draws its own chip in the strongest tone.
 */

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

beforeEach(() => {
  mockRpc.mockReset();
});

const PROBLEM_ID = 'd1e2f3a4-1111-4111-8111-d1e2f3a40001';

function problem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: PROBLEM_ID,
    property_id: 412432,
    task_id: null,
    reported_by: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    title: 'Затопило ванную',
    description: null,
    priority: 'high',
    critical: true,
    status: 'open',
    resolved_at: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: '2026-11-15T08:00:00+00:00',
    property: { name: 'CZ - Nadrazni Apt 6', hostaway_unit_id: null, parent: null },
    fix_tasks: [],
    ...overrides,
  };
}

function fillOf(element: { props: { style?: unknown } }): ViewStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle);
}

describe('the scale of four', () => {
  test('critical stands above high: the more urgent first', () => {
    expect([...PROBLEM_LEVELS]).toEqual(['low', 'normal', 'high', 'critical']);
    expect((['high', 'low', 'critical', 'normal'] as const).slice().sort(byUrgencyFirst)).toEqual([
      'critical',
      'high',
      'normal',
      'low',
    ]);
  });

  test('critical is stored as high with the flag, and read back as critical', () => {
    expect(storedUrgency('critical')).toEqual({ priority: 'high', critical: true });
    expect(storedUrgency('high')).toEqual({ priority: 'high', critical: false });
    expect(problemLevel({ priority: 'high', critical: true })).toBe('critical');
    // A copy saved before the level has no flag: it was high, and reads high.
    expect(problemLevel({ priority: 'high' })).toBe('high');
  });

  test('critical has its own tone, apart from the high one', () => {
    expect(problemLevelTone('critical')).toBe('critical');
    expect(problemLevelTone('high')).toBe('urgent');
  });
});

describe('an older phone and the new value', () => {
  // What builds №12 (iPhone) and №19 (Android) parse priority with: a strict
  // enum of three inside one z.array — one row it does not know fails the list.
  const OLD_LIST = z.array(z.object({ priority: z.enum(['low', 'normal', 'high']) }));

  test('a critical task as the server answers it parses through the old list', () => {
    const answered = [problem(), problem({ priority: 'normal', critical: false })];

    expect(OLD_LIST.safeParse(answered).success).toBe(true);
  });

  test('a copy an older build saved, without the flag, parses and reads as it was', () => {
    const { critical: _critical, ...saved } = problem();

    const [read] = problemListSchema.parse([saved]);

    expect(problemLevel(read)).toBe('high');
  });

  test('a flag the phone cannot read is not critical, and the list still parses', () => {
    const [read] = problemListSchema.parse([{ ...problem(), critical: 'yes' }]);

    expect(problemLevel(read)).toBe('high');
  });
});

describe('her list, the board and the repairs', () => {
  test('a critical task carries «Критическая», filled in the strongest tone', async () => {
    await render(<ProblemCard problem={problem()} onPress={jest.fn()} />);

    const flag = screen.getByTestId('problem-urgent');
    expect(within(flag).getByText('Критическая')).toBeTruthy();
    expect(fillOf(flag).backgroundColor).toBe(TONE_COLORS.light.critical.mark);
    expect(screen.queryByText('Срочно')).toBeNull();
    expect(screen.getByRole('button', { name: /Критическая/ })).toBeTruthy();
  });

  test('a high one keeps «Срочно» in the urgent tone', async () => {
    await render(<ProblemCard problem={problem({ critical: false })} onPress={jest.fn()} />);

    const flag = screen.getByTestId('problem-urgent');
    expect(within(flag).getByText('Срочно')).toBeTruthy();
    expect(fillOf(flag).backgroundColor).toBe(TONE_COLORS.light.urgent.bg);
  });

  test("the head technician's board marks a live critical task «Критическая»", async () => {
    await render(
      <BoardCard
        problem={boardProblem({ priority: 'high', critical: true })}
        names={new Map()}
        onPress={jest.fn()}
      />,
    );

    expect(within(screen.getByTestId('board-urgent')).getByText('Критическая')).toBeTruthy();
  });

  test('a repair of a critical task carries «Критическая» in the cleanings list', async () => {
    const repair: CleaningTask = {
      id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
      status: 'assigned',
      priority: 0,
      scheduled_date: '2026-11-15',
      due_at: null,
      assignee_id: '9d2ff806-4bea-4aa5-be3c-1b07a629dbee',
      property_id: 412432,
      property: {
        name: 'CZ - Nadrazni Apt 6',
        address: 'Nádražní 6',
        hostaway_unit_id: null,
        effective_cleaner_notes: null,
        parent: null,
      },
      time_from: null,
      time_to: null,
      guests_count: null,
      started_at: null,
      completed_at: null,
      is_parallel: false,
      type: 'maintenance',
      notes: null,
      title: null,
      title_i18n: {},
      reservation_id: null,
      problem: {
        id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
        title: 'Прорвало трубу',
        priority: 'high',
        critical: true,
      },
    };

    await render(<TaskCard task={repair} onPress={jest.fn()} />);

    expect(within(screen.getByTestId('task-urgent')).getByText('Критическая')).toBeTruthy();
    expect(screen.getByRole('button', { name: /срочность: Критическая/ })).toBeTruthy();
  });

  test('a category of the level shows it on its chip', async () => {
    await render(<PriorityChip priority="critical" testID="chip" />);

    expect(within(screen.getByTestId('chip')).getByText('Критическая')).toBeTruthy();
  });
});

describe('her form and what it sends', () => {
  /** The form, and beside it what the route would send for its level. */
  function Harness() {
    const [draft, setDraft] = useState<ProblemDraft>(EMPTY_PROBLEM_DRAFT);
    const sent = storedUrgency(draft.priority);
    return (
      <>
        <ProblemForm
          draft={draft}
          onChange={setDraft}
          categories={null}
          place={null}
          isSubmitting={false}
          submitLabel="Отправить"
          onSubmit={jest.fn()}
          error={null}
        />
        <Text testID="sent">{`${sent.priority}/${String(sent.critical)}`}</Text>
      </>
    );
  }

  test('she may choose «Критическая»; it is sent as high with the flag', async () => {
    await render(<Harness />);

    await fireEvent.press(screen.getByRole('radio', { name: 'Критическая' }));

    expect(screen.getByRole('radio', { name: 'Критическая' })).toBeChecked();
    expect(screen.getByTestId('sent')).toHaveTextContent('high/true');
  });

  test('a critical task she corrects opens at «Критическая»', () => {
    expect(draftOfProblem(problem()).priority).toBe('critical');
    expect(draftOfProblem(problem({ critical: false })).priority).toBe('high');
  });

  test('the report goes out with p_critical; a correction queued before the level without it', async () => {
    mockRpc.mockResolvedValue({ data: problem(), error: null });

    await reportProblem({
      problemId: PROBLEM_ID,
      title: 'Затопило ванную',
      description: '',
      ...storedUrgency('critical'),
    });
    // Replayed from a queue a build before the level wrote: no `critical` at all.
    await updateProblem({
      problemId: PROBLEM_ID,
      title: 'Затопило ванную',
      description: '',
      priority: 'high',
    });

    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_priority: 'high', p_critical: true });
    expect(JSON.parse(JSON.stringify(mockRpc.mock.calls[1][1]))).not.toHaveProperty('p_critical');
  });
});
