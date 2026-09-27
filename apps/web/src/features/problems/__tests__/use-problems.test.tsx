import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  assignProblem: vi.fn(async () => ({})),
  cancelProblem: vi.fn(async () => ({})),
  resolveProblem: vi.fn(async () => ({})),
  archiveProblem: vi.fn(async () => ({})),
}));

import { taskKeys } from '@/features/tasks/keys';

import { problemKeys } from '../keys';
import {
  useArchiveProblem,
  useAssignProblem,
  useCancelProblem,
  useResolveProblem,
} from '../use-problems';

/**
 * A problem's repair is a task: assigning, cancelling, resolving or archiving
 * a problem changes it. The calendar and the Cleanings screen (/tasks) read tasks, so a
 * write on a problem wakes them too (docs/f10-plan.md, §6) — otherwise a
 * repair moved on its problem's page stays on its old day for up to 30 s.
 */
function renderWithCache<T>(hook: () => T) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(hook, { wrapper }), invalidate };
}

const PROBLEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('a write on a problem', () => {
  test('assigning it wakes the problems and the tasks', async () => {
    const { result, invalidate } = renderWithCache(() => useAssignProblem());

    await act(async () => {
      await result.current.mutateAsync({
        problemId: PROBLEM,
        assigneeId: '11111111-1111-4111-8111-111111111111',
        scheduledDate: '2026-09-28',
        timeFrom: null,
        timeTo: null,
      });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: problemKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.all });
  });

  test('cancelling it does too', async () => {
    const { result, invalidate } = renderWithCache(() => useCancelProblem());

    await act(async () => {
      await result.current.mutateAsync({ problemId: PROBLEM, reason: '' });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.all });
  });

  test('resolving and archiving it do too', async () => {
    for (const useWrite of [useResolveProblem, useArchiveProblem]) {
      const { result, invalidate } = renderWithCache(() => useWrite());

      await act(async () => {
        await result.current.mutateAsync(PROBLEM);
      });

      expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.all });
    }
  });
});
