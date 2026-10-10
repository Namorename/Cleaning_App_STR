import { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { restoredFromDisk, withClient } from '@/testing/restored-cache';

import { fetchMyDoneTasks, fetchTask } from '../api';
import { DONE_PAGE_SIZE } from '../done';
import type { CleaningTask } from '../schema';
import { taskKeys, useMyDoneTasks, useTask } from '../use-tasks';

/**
 * «Выполненные» (owner, 2026-10-10): read only once she opens it, a page at a
 * time, and never in the way of her open list. Saved to disk like every read
 * of the phone, so it is read back through the schema.
 */

jest.mock('../api', () => ({
  fetchMyTasks: jest.fn(),
  fetchMyDoneTasks: jest.fn(),
  fetchFreeTasks: jest.fn(),
  fetchTask: jest.fn(),
  claimTask: jest.fn(),
  acceptTask: jest.fn(),
  startTask: jest.fn(),
  finishTask: jest.fn(),
}));

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

const fetchDone = jest.mocked(fetchMyDoneTasks);

function doneTask(index: number): CleaningTask {
  return {
    id: `3f2a1c4e-5b6d-4e8f-9a0b-${String(index).padStart(12, '0')}`,
    status: 'done',
    priority: 0,
    scheduled_date: '2026-10-09',
    due_at: null,
    assignee_id: ME,
    property_id: 412432,
    property: {
      name: 'CZ - Nadrazni Apt 6',
      address: 'Nádražní 6',
      hostaway_unit_id: null,
      effective_cleaner_notes: null,
      parent: null,
    },
    time_from: '10:00:00',
    time_to: '15:00:00',
    guests_count: null,
    started_at: '2026-10-09T08:05:00+00:00',
    completed_at: '2026-10-09T10:40:00+00:00',
    is_parallel: false,
    type: 'cleaning',
    notes: null,
    title: null,
    title_i18n: {},
  };
}

const FULL_PAGE = Array.from({ length: DONE_PAGE_SIZE }, (_, index) => doneTask(index + 1));

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchTask).mockReturnValue(new Promise(() => {}));
});

test('closed, nothing is read', async () => {
  const { result } = await renderHook(() => useMyDoneTasks(false), {
    wrapper: withClient(freshClient()),
  });

  expect(fetchDone).not.toHaveBeenCalled();
  expect(result.current.data).toBeUndefined();
});

test('opened, the first page is read for her, from the start of the window', async () => {
  fetchDone.mockResolvedValue([doneTask(1)]);

  const { result } = await renderHook(() => useMyDoneTasks(true), {
    wrapper: withClient(freshClient()),
  });

  await waitFor(() => expect(result.current.data).toHaveLength(1));
  const [who, page, since] = fetchDone.mock.calls[0];
  expect(who).toBe(ME);
  expect(page).toBe(0);
  expect(Number.isNaN(Date.parse(since))).toBe(false);
  // A page shorter than full is the last one.
  expect(result.current.hasNextPage).toBe(false);
});

test('a full page means there may be more: the next one is read on demand', async () => {
  fetchDone.mockResolvedValueOnce(FULL_PAGE).mockResolvedValueOnce([doneTask(99)]);

  const { result } = await renderHook(() => useMyDoneTasks(true), {
    wrapper: withClient(freshClient()),
  });

  await waitFor(() => expect(result.current.hasNextPage).toBe(true));
  expect(fetchDone).toHaveBeenCalledTimes(1);

  await act(async () => {
    await result.current.fetchNextPage();
  });

  expect(fetchDone.mock.calls[1][1]).toBe(1);
  await waitFor(() => expect(result.current.data).toHaveLength(DONE_PAGE_SIZE + 1));
  expect(result.current.data?.at(-1)?.id).toBe(doneTask(99).id);
  expect(result.current.hasNextPage).toBe(false);
});

test('a job a later page repeats is shown once', async () => {
  fetchDone.mockResolvedValueOnce(FULL_PAGE).mockResolvedValueOnce([FULL_PAGE[19], doneTask(50)]);

  const { result } = await renderHook(() => useMyDoneTasks(true), {
    wrapper: withClient(freshClient()),
  });
  await waitFor(() => expect(result.current.hasNextPage).toBe(true));
  await act(async () => {
    await result.current.fetchNextPage();
  });

  await waitFor(() => expect(fetchDone).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.isFetchingNextPage).toBe(false));
  const ids = result.current.data?.map((task) => task.id) ?? [];
  expect(ids).toHaveLength(DONE_PAGE_SIZE + 1);
  expect(new Set(ids).size).toBe(ids.length);
});

test('pages saved by an older build read through the schema, the missing note as null', async () => {
  fetchDone.mockReturnValue(new Promise(() => {}));
  const { notes: _dropped, ...withoutNote } = doneTask(1);
  const client = restoredFromDisk(taskKeys.done(ME), {
    pages: [[withoutNote]],
    pageParams: [0],
  });

  const { result } = await renderHook(() => useMyDoneTasks(true), { wrapper: withClient(client) });

  expect(result.current.data?.[0].notes).toBeNull();
});

test('a finished job opened from the list shows at once, from the page it is on', async () => {
  const client = freshClient();
  client.setQueryData(taskKeys.done(ME), { pages: [[doneTask(7)]], pageParams: [0] });

  const { result } = await renderHook(() => useTask(doneTask(7).id), {
    wrapper: withClient(client),
  });

  expect(result.current.data?.status).toBe('done');
  expect(result.current.data?.id).toBe(doneTask(7).id);
});
