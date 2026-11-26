import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { problemSchema, type Problem } from '../schema';

/**
 * «Удалить навсегда» of an archived task (owner, 2026-11-26; 20261126150000): in the archive of
 * «Задания» and on the archived task's page, for an admin alone, after a question that says what
 * goes with it and that it cannot be undone.
 */

const ARCHIVED_ID = '11111111-1111-4111-8111-111111111111';
const LIVE_ID = '33333333-3333-4333-8333-333333333333';

const base = {
  property_id: 1,
  task_id: null,
  reported_by: '22222222-2222-4222-8222-222222222222',
  description: null,
  priority: 'normal',
  resolved_at: null,
  cancel_reason: null,
  created_at: '2026-09-09T10:00:00+00:00',
  property: { name: 'Vinohrady 12' },
  reporter: { full_name: 'Maria Test' },
  fix_tasks: [],
};

const archived: Problem = problemSchema.parse({
  ...base,
  id: ARCHIVED_ID,
  title: 'Течёт кран',
  status: 'cancelled',
  cancelled_at: '2026-11-20T10:00:00+00:00',
  archived_at: '2026-11-20T10:00:00+00:00',
});
const live: Problem = problemSchema.parse({
  ...base,
  id: LIVE_ID,
  title: 'Сломан замок',
  status: 'open',
  cancelled_at: null,
});

const purge = vi.fn();
const unarchive = vi.fn();
/** What the delete ended in last: the server's refusal, when a test sets one. */
const purgeOutcome: { isError: boolean; error: unknown } = { isError: false, error: null };
const idle = { isPending: false, isError: false, error: null, mutate: vi.fn(), reset: vi.fn() };

vi.mock('../use-problems', () => ({
  useResolveProblem: () => idle,
  useCancelProblem: () => idle,
  useReopenProblem: () => idle,
  useArchiveProblem: () => idle,
  useUnarchiveProblem: () => ({ ...idle, mutate: unarchive }),
  useMarkFalsePositive: () => idle,
  useWorkers: () => ({ data: [], isPending: false, isError: false }),
  useDeleteArchivedProblem: () => ({
    ...idle,
    ...purgeOutcome,
    mutate: (id: string, options?: { onSuccess?: () => void; onSettled?: () => void }) => {
      purge(id);
      if (!purgeOutcome.isError) {
        options?.onSuccess?.();
      }
      options?.onSettled?.();
    },
  }),
}));
// The closing dialog of the page asks for the company's video limits and the client.
vi.mock('@/features/settings/use-settings', () => ({
  useHostSettings: () => ({ data: { video_max_sec: 120, video_max_mb: 100 } }),
}));
vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));
vi.mock('@/features/chat/use-chat', () => ({
  useUnreadSubjects: () => ({ tasks: new Set<string>(), problems: new Set<string>() }),
}));

import { deleteArchivedProblem, type Client } from '../api';
import { ProblemActions } from '../problem-actions';
import { ProblemsArchive } from '../problems-archive';

const row = (title: string) =>
  screen.getByRole('link', { name: title }).closest('li') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  purgeOutcome.isError = false;
  purgeOutcome.error = null;
});

describe('the archive of «Задания»', () => {
  test('an admin has «Удалить навсегда» beside «Восстановить из архива»', () => {
    render(<ProblemsArchive problems={[archived]} isAdmin />);

    expect(
      within(row('Течёт кран')).getByRole('button', { name: 'Восстановить из архива' }),
    ).toBeInTheDocument();
    expect(
      within(row('Течёт кран')).getByRole('button', { name: 'Удалить навсегда' }),
    ).toBeInTheDocument();
  });

  test('a manager does not', () => {
    render(<ProblemsArchive problems={[archived]} />);

    expect(
      within(row('Течёт кран')).queryByRole('button', { name: 'Удалить навсегда' }),
    ).toBeNull();
  });

  test('asks first, saying what goes with it; «Оставить» sends nothing', async () => {
    const user = userEvent.setup();
    render(<ProblemsArchive problems={[archived]} isAdmin />);

    await user.click(within(row('Течёт кран')).getByRole('button', { name: 'Удалить навсегда' }));
    const question = screen.getByRole('dialog', { name: 'Удалить задание навсегда?' });
    expect(question).toHaveTextContent(
      'Задание «Течёт кран» удалится вместе со всем, что к нему относится: ремонтами и их шагами, фото, видео и файлами, перепиской и журналом.',
    );
    expect(question).toHaveTextContent('Отменить это нельзя');
    await user.click(within(question).getByRole('button', { name: 'Оставить' }));

    expect(purge).not.toHaveBeenCalled();
  });

  test('«Да, удалить навсегда» deletes that task', async () => {
    const user = userEvent.setup();
    render(<ProblemsArchive problems={[archived]} isAdmin />);

    await user.click(within(row('Течёт кран')).getByRole('button', { name: 'Удалить навсегда' }));
    await user.click(screen.getByRole('button', { name: 'Да, удалить навсегда' }));

    expect(purge).toHaveBeenCalledWith(ARCHIVED_ID);
    expect(unarchive).not.toHaveBeenCalled();
  });

  test('a refusal is said in the reader’s words, with the server’s line under it', () => {
    purgeOutcome.isError = true;
    purgeOutcome.error = {
      message: 'Problem is not archived',
      hint: 'serverErrors.problemNotArchived',
    };
    render(<ProblemsArchive problems={[archived]} isAdmin />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Задание не в архиве — навсегда удаляется только задание из архива',
    );
  });
});

describe('the archived task’s page', () => {
  test('an admin deletes it for good there, and the page leaves', async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    render(<ProblemActions problem={archived} isAdmin onDeleted={onDeleted} />);

    expect(screen.getByRole('button', { name: 'Восстановить из архива' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Удалить навсегда' }));
    await user.click(screen.getByRole('button', { name: 'Да, удалить навсегда' }));

    expect(purge).toHaveBeenCalledWith(ARCHIVED_ID);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  test('a manager sees «Восстановить из архива» alone', () => {
    render(<ProblemActions problem={archived} />);

    expect(screen.getByRole('button', { name: 'Восстановить из архива' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить навсегда' })).toBeNull();
  });

  test('a task not in the archive offers no delete for good, even to an admin', () => {
    render(<ProblemActions problem={live} isAdmin />);

    expect(screen.queryByRole('button', { name: 'Удалить навсегда' })).toBeNull();
  });
});

describe('what the panel sends', () => {
  test('delete_archived_problem with the task’s id; true when deleted, false when gone', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const client = { rpc } as unknown as Client;

    expect(await deleteArchivedProblem(client, ARCHIVED_ID)).toBe(true);
    expect(await deleteArchivedProblem(client, ARCHIVED_ID)).toBe(false);
    expect(rpc).toHaveBeenCalledWith('delete_archived_problem', { p_id: ARCHIVED_ID });
  });

  test('a refusal is thrown as the server gave it', async () => {
    const refusal = {
      message: 'Only an admin may delete for good',
      hint: 'serverErrors.archivePurgeAdminOnly',
    };
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: refusal }),
    } as unknown as Client;

    await expect(deleteArchivedProblem(client, ARCHIVED_ID)).rejects.toBe(refusal);
  });
});
