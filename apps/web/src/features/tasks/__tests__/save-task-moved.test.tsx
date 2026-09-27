import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';

import type { TaskDraft } from '../schema';

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

const saveTask = vi.fn();
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  saveTask: (...args: unknown[]) => saveTask(...args),
}));

import { useSaveTask } from '../use-tasks';

/**
 * A save refused because the task moved while the form was open
 * (serverErrors.taskMovedMeanwhile, 20260926160000): the booking moved it, so
 * the list, the calendar's tasks AND its bookings are behind. The bookings and
 * the expired live outside `tasks` (docs/f10-plan.md, §1), so an ordinary save
 * leaves them be; this refusal rereads them too.
 */

const TASKS_LIST = ['tasks', 'list'];
const CALENDAR_TASKS = ['tasks', 'calendar', 'active', '2026-09'];
const BOOKINGS = ['calendar', 'bookings', '2026-09'];
const EXPIRED = ['calendar', 'expired', '2026-09'];

const draft: TaskDraft = {
  id: '55555555-5555-4555-8555-555555555555',
  propertyId: 1,
  type: 'cleaning',
  scheduledDate: '2026-09-16',
  title: '',
  assigneeId: null,
  timeFrom: null,
  timeTo: null,
  notes: '',
  expectedDate: '2026-09-14',
};

const refusal = (hint: string, details: Record<string, unknown>) =>
  Object.assign(new Error('refused'), { hint, details: JSON.stringify(details) });

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  for (const key of [TASKS_LIST, CALENDAR_TASKS, BOOKINGS, EXPIRED]) {
    queryClient.setQueryData(key, []);
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSaveTask(), { wrapper });
  const isStale = (key: readonly unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated ?? false;
  const save = async () => {
    await act(async () => {
      await result.current.mutateAsync({ draft }).catch(() => undefined);
    });
  };
  return { save, isStale };
}

describe('a save of a task', () => {
  test('refused as moved meanwhile rereads the tasks and the calendar’s bookings and expired', async () => {
    saveTask.mockRejectedValueOnce(
      refusal('serverErrors.taskMovedMeanwhile', { date: '2026-09-18' }),
    );
    const { save, isStale } = setup();

    await save();

    expect([TASKS_LIST, CALENDAR_TASKS, BOOKINGS, EXPIRED].map(isStale)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  test('refused for another reason rereads nothing', async () => {
    saveTask.mockRejectedValueOnce(refusal('serverErrors.taskDuplicate', { date: '2026-09-16' }));
    const { save, isStale } = setup();

    await save();

    expect([TASKS_LIST, CALENDAR_TASKS, BOOKINGS, EXPIRED].map(isStale)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  test('that went through rereads the tasks, not the bookings', async () => {
    saveTask.mockResolvedValueOnce({});
    const { save, isStale } = setup();

    await save();

    expect([TASKS_LIST, CALENDAR_TASKS, BOOKINGS, EXPIRED].map(isStale)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
