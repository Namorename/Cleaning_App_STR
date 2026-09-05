import {
  checkedLines,
  commentText,
  isSupportedStepType,
  noteLines,
  remainingRequired,
  stepState,
  taskStepSchema,
  type TaskStep,
} from '../schema';

function step(overrides: Partial<TaskStep> = {}): TaskStep {
  return {
    id: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001',
    task_id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
    sort_order: 1,
    type: 'confirmation',
    required: false,
    title: null,
    instructions: null,
    started_at: null,
    completed_at: null,
    completed_by: null,
    payload: {},
    skipped_at: null,
    skip_reason: null,
    waived_at: null,
    waive_reason: null,
    ...overrides,
  };
}

describe('noteLines', () => {
  test('splits on CR/LF and drops blank lines, like the database does', () => {
    // Arrange: the fixture shared with supabase/tests/task_workflow.sql, where
    // task_note_line_count() answers 2 for the same text.
    const note = 'a\r\n\n b \n';

    // Act
    const lines = noteLines(note);

    // Assert
    expect(lines).toEqual(['a', 'b']);
  });

  test('reads a missing note as no lines', () => {
    expect(noteLines(null)).toEqual([]);
  });
});

describe('stepState', () => {
  test('a completed step is done whatever else is set', () => {
    expect(stepState(step({ completed_at: '2026-09-05T10:00:00+00:00' }))).toBe('done');
  });

  test('a waived step reads as waived', () => {
    expect(
      stepState(step({ required: true, waived_at: '2026-09-05T10:00:00+00:00', waive_reason: 'x' })),
    ).toBe('waived');
  });

  test('a skipped step reads as skipped', () => {
    expect(stepState(step({ skipped_at: '2026-09-05T10:00:00+00:00' }))).toBe('skipped');
  });

  test('a step of a type this build cannot complete reads as unsupported', () => {
    expect(stepState(step({ type: 'photos_before' }))).toBe('unsupported');
    expect(isSupportedStepType('photos_before')).toBe(false);
  });

  test('otherwise the step is pending', () => {
    expect(stepState(step({ type: 'task_note' }))).toBe('pending');
  });
});

describe('remainingRequired', () => {
  test('counts required steps neither completed nor waived', () => {
    const steps = [
      step({ required: true }),
      step({ required: true, completed_at: '2026-09-05T10:00:00+00:00' }),
      step({ required: true, waived_at: '2026-09-05T10:00:00+00:00', waive_reason: 'x' }),
      step({ required: false }),
    ];

    expect(remainingRequired(steps)).toBe(1);
  });

  test('is zero for a process with nothing required — the soft start', () => {
    expect(remainingRequired([step(), step({ type: 'task_note' })])).toBe(0);
  });
});

describe('payload readers', () => {
  test('reads ticked lines back from the stored answer', () => {
    expect(checkedLines(step({ type: 'task_note', payload: { checked_lines: [0, 2] } }))).toEqual([
      0, 2,
    ]);
  });

  test('reads an unreadable answer as nothing ticked', () => {
    expect(checkedLines(step({ type: 'task_note', payload: { checked_lines: 'all' } }))).toEqual([]);
  });

  test('keeps the comment draft', () => {
    expect(commentText(step({ type: 'cleaner_comment', payload: { text: 'all good' } }))).toBe(
      'all good',
    );
  });
});

describe('taskStepSchema', () => {
  test('accepts a step type it has never heard of', () => {
    // A future migration adds a type before the app is updated; the task
    // screen must still render, showing that one step as unavailable.
    const parsed = taskStepSchema.parse({ ...step(), type: 'drone_survey' });

    expect(stepState(parsed)).toBe('unsupported');
  });
});
