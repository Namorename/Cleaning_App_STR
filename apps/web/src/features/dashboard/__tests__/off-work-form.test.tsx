import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Task } from '@/features/tasks/schema';

interface TaskRead {
  data: Task | null | undefined;
  isError: boolean;
  error: unknown;
}

const read: { current: TaskRead } = {
  current: { data: undefined, isError: false, error: null },
};

vi.mock('@/features/tasks/use-tasks', () => ({ useTask: () => read.current }));
// The form itself is tested on its own (tasks/__tests__/task-form.test.tsx).
vi.mock('@/features/tasks/task-form', () => ({
  TaskForm: ({ task }: { task: Task }) => <div role="dialog">form of {task.id}</div>,
}));

import { OffWorkForm } from '../off-work-form';

const TASK_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  read.current = { data: undefined, isError: false, error: null };
});

/**
 * A row of «Уборки в работе у отключённых» opens its job in the task form —
 * where the manager hands it on — once the job is read whole.
 */
describe('the job a row of the dashboard opens', () => {
  test('opens in the task form once it is read', () => {
    read.current = { data: { id: TASK_ID } as Task, isError: false, error: null };

    render(<OffWorkForm taskId={TASK_ID} onClose={() => undefined} />);

    expect(screen.getByRole('dialog')).toHaveTextContent(`form of ${TASK_ID}`);
  });

  test('says it is reading until then', () => {
    render(<OffWorkForm taskId={TASK_ID} onClose={() => undefined} />);

    expect(screen.getByRole('dialog')).toHaveTextContent('Загружаем уборки…');
  });

  test('a job no longer there says so, with the server’s words when it refused', () => {
    read.current = {
      data: undefined,
      isError: true,
      error: { message: 'permission denied for table tasks' },
    };

    render(<OffWorkForm taskId={TASK_ID} onClose={() => undefined} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Уборку не удалось открыть.');
    expect(dialog).toHaveTextContent('permission denied for table tasks');
  });
});
