import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

const fetchTasksBetween = vi.fn(async () => []);
const saveTask = vi.fn(async () => ({}));
vi.mock('@/features/tasks/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/tasks/api')>()),
  fetchTasksBetween: (...args: unknown[]) => fetchTasksBetween(...(args as [])),
  saveTask: (...args: unknown[]) => saveTask(...(args as [])),
}));

import { useSaveTask } from '@/features/tasks/use-tasks';

import { windowDays } from '../dates';
import { useCalendarTasks } from '../use-calendar';

/**
 * The calendar's tasks live under `taskKeys.all` (docs/f10-plan.md, §1), so
 * the form that saves a task wakes them without any wiring of its own
 * (7.4 [агент]).
 */
describe('saving a task in the form', () => {
  test('makes the calendar read its tasks again', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const readsOfSeptember = () =>
      fetchTasksBetween.mock.calls.filter((call) => (call as unknown[])[1] === '2026-09-01').length;

    const { result } = renderHook(
      () => ({
        tasks: useCalendarTasks({} as never, false, windowDays('2026-09-25', 7)),
        save: useSaveTask(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.tasks.data).toBeDefined());
    const before = readsOfSeptember();

    await act(async () => {
      await result.current.save.mutateAsync({
        draft: {
          id: '33333333-3333-4333-8333-333333333333',
          propertyId: 1,
          type: 'inspection',
          scheduledDate: '2026-09-28',
          title: '',
          assigneeId: null,
          timeFrom: null,
          timeTo: null,
          notes: '',
        },
      });
    });

    await waitFor(() => expect(readsOfSeptember()).toBeGreaterThan(before));
  });
});
