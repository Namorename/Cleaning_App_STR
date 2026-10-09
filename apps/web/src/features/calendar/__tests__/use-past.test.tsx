import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { pastChunk } from '../dates';
import { useCalendarPast } from '../use-past';

/**
 * The past on demand (the owner's word of 2026-10-10, block 7): nothing is
 * held until it is asked for; a chunk is shown once its data has come; a
 * failed one says so and keeps what is shown; sixty days is the limit.
 */

const TODAY = '2026-10-10';
const START = '2026-10-09';
const FIRST_CHUNK = pastChunk(START, TODAY);
const SECOND_CHUNK = pastChunk(FIRST_CHUNK[0], TODAY);

function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

interface Props {
  start: string;
  depth: number;
  isReady: boolean;
  load: (days: readonly string[]) => Promise<unknown>;
}

function renderPast(load: Props['load'], props: Partial<Props> = {}) {
  return renderHook((current: Props) => useCalendarPast({ ...current, today: TODAY }), {
    initialProps: { start: START, depth: 7, isReady: true, load, ...props },
  });
}

describe('the past of the calendar', () => {
  test('holds nothing until it is asked for', () => {
    const load = vi.fn(async () => {});
    const { result } = renderPast(load);

    expect(result.current.days).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isAtLimit).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  // Whatever a failed read hands over — even nothing — the failure is told.
  test('a chunk refused without a reason is a failure all the same', async () => {
    const load = vi.fn(() => Promise.reject(undefined));
    const { result } = renderPast(load);

    await act(async () => result.current.loadMore());

    expect(result.current.isError).toBe(true);
    expect(result.current.days).toEqual([]);
  });

  test('a chunk is shown once its data has come, not before', async () => {
    const answer = deferred();
    const load = vi.fn(() => answer.promise);
    const { result } = renderPast(load);

    act(() => result.current.loadMore());

    expect(load).toHaveBeenCalledWith(FIRST_CHUNK);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.days).toEqual([]);

    await act(async () => answer.resolve());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.days).toEqual(FIRST_CHUNK);
  });

  test('the next chunk goes before the one shown', async () => {
    const load = vi.fn(async () => {});
    const { result } = renderPast(load);

    await act(async () => result.current.loadMore());
    await act(async () => result.current.loadMore());

    expect(load).toHaveBeenLastCalledWith(SECOND_CHUNK);
    expect(result.current.days).toEqual([...SECOND_CHUNK, ...FIRST_CHUNK]);
    expect(result.current.days[0]).toBe('2026-09-11');
  });

  test('asked again while a chunk is on its way, it asks nothing more', async () => {
    const answer = deferred();
    const load = vi.fn(() => answer.promise);
    const { result } = renderPast(load);

    act(() => result.current.loadMore());
    act(() => result.current.loadMore());
    act(() => result.current.loadMore());
    await act(async () => answer.resolve());

    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.days).toEqual(FIRST_CHUNK);
  });

  test('a chunk that fails says so, keeps what is shown, and is asked again on the next press', async () => {
    const failure = { message: 'canceling statement due to statement timeout' };
    const load = vi.fn(async () => {});
    const { result } = renderPast(load);
    await act(async () => result.current.loadMore());

    load.mockRejectedValueOnce(failure);
    await act(async () => result.current.loadMore());

    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBe(failure);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.days).toEqual(FIRST_CHUNK);

    await act(async () => result.current.loadMore());

    expect(load).toHaveBeenCalledTimes(3);
    expect(load).toHaveBeenLastCalledWith(SECOND_CHUNK);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.days).toEqual([...SECOND_CHUNK, ...FIRST_CHUNK]);
  });

  test('stops at sixty days before today, and says it has', async () => {
    const load = vi.fn(async () => {});
    const { result } = renderPast(load);

    for (let press = 0; press < 5; press += 1) {
      await act(async () => result.current.loadMore());
    }

    expect(result.current.days[0]).toBe('2026-08-11');
    expect(result.current.days).toHaveLength(59);
    expect(result.current.isAtLimit).toBe(true);

    await act(async () => result.current.loadMore());
    expect(load).toHaveBeenCalledTimes(5);
  });

  test('asks nothing before there is a client to read with', () => {
    const load = vi.fn(async () => {});
    const { result } = renderPast(load, { isReady: false });

    act(() => result.current.loadMore());

    expect(load).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  test('a new window drops the past, and a chunk still on its way stays unshown', async () => {
    const load = vi.fn(async () => {});
    const { result, rerender } = renderPast(load);
    await act(async () => result.current.loadMore());
    expect(result.current.days).toHaveLength(14);

    const late = deferred();
    load.mockImplementationOnce(() => late.promise);
    act(() => result.current.loadMore());

    rerender({ start: '2026-10-02', depth: 7, isReady: true, load });
    expect(result.current.days).toEqual([]);
    expect(result.current.isLoading).toBe(false);

    // Back where it was: the past it had is not brought back either.
    rerender({ start: START, depth: 7, isReady: true, load });
    await act(async () => late.resolve());
    expect(result.current.days).toEqual([]);
  });

  test('another depth is another window too', async () => {
    const load = vi.fn(async () => {});
    const { result, rerender } = renderPast(load);
    await act(async () => result.current.loadMore());

    rerender({ start: START, depth: 30, isReady: true, load });

    expect(result.current.days).toEqual([]);
  });

  test('dropped on demand: «Сегодня» on the window it is already on', async () => {
    const load = vi.fn(async () => {});
    const { result } = renderPast(load);
    await act(async () => result.current.loadMore());

    act(() => result.current.reset());

    expect(result.current.days).toEqual([]);
  });
});
