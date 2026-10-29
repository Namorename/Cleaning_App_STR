import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';

import type { TaskDraft } from '../schema';

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

const order: string[] = [];
const saveTask = vi.fn(async () => {
  order.push('save_task');
  return { id: 'saved' };
});
const setCleaningTime = vi.fn(async () => {
  order.push('set_cleaning_time');
  return { id: 'hours' };
});
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  saveTask: (...args: unknown[]) => saveTask(...(args as [])),
  setCleaningTime: (...args: unknown[]) => setCleaningTime(...(args as [])),
}));

import { useSaveTask } from '../use-tasks';

/**
 * The form's save of a booking's cleaning with hours set by hand
 * (20261027120000): the task first, then the hours, for the day the save left
 * the cleaning on. A save without the hand is the task alone, as before.
 */

const draft: TaskDraft = {
  id: '55555555-5555-4555-8555-555555555556',
  propertyId: 1,
  type: 'cleaning',
  scheduledDate: '2026-09-16',
  title: '',
  assigneeId: null,
  timeFrom: '12:00',
  timeTo: '14:30',
  notes: '',
  expectedDate: '2026-09-14',
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSaveTask(), { wrapper });
  const save = async (variables: { draft: TaskDraft }) => {
    let answer: unknown;
    await act(async () => {
      answer = await result.current.mutateAsync(variables);
    });
    return answer;
  };
  return { save };
}

describe('a save of a booking’s cleaning', () => {
  test('with hours set by hand: the task, then the hours on its new day', async () => {
    order.length = 0;
    setCleaningTime.mockClear();
    const { save } = setup();

    const answer = await save({ draft: { ...draft, manualTime: true } });

    expect(order).toEqual(['save_task', 'set_cleaning_time']);
    expect(setCleaningTime.mock.calls[0]).toEqual([
      {},
      {
        taskId: draft.id,
        timeFrom: '12:00',
        timeTo: '14:30',
        expectedDate: '2026-09-16',
      },
    ]);
    expect(answer).toEqual({ id: 'hours' });
  });

  test('without them: the task alone', async () => {
    order.length = 0;
    setCleaningTime.mockClear();
    const { save } = setup();

    const answer = await save({ draft });

    expect(order).toEqual(['save_task']);
    expect(setCleaningTime).not.toHaveBeenCalled();
    expect(answer).toEqual({ id: 'saved' });
  });
});
