import { QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { withClient } from '@/testing/restored-cache';

import { fetchKbArticles, fetchKbPlace } from '../api';
import { knowledgeKeys } from '../keys';
import { retryKnowledge, useKbArticles, useKbPlace } from '../use-knowledge';

jest.mock('../api', () => ({ fetchKbArticles: jest.fn(), fetchKbPlace: jest.fn() }));

const articles = jest.mocked(fetchKbArticles);
const place = jest.mocked(fetchKbPlace);

function client(): QueryClient {
  // gcTime Infinity schedules no collection timer, so nothing holds the worker.
  return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('the articles are read for this session only: the disk never keeps them', async () => {
  articles.mockResolvedValue([]);
  const queries = client();

  const { result } = await renderHook(() => useKbArticles(), { wrapper: withClient(queries) });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(queries.getQueryCache().find({ queryKey: knowledgeKeys.articles() })?.meta).toEqual({
    persist: false,
  });
});

test('a cloud without the knowledge base yet is asked once, not again and again', async () => {
  articles.mockRejectedValue({ code: 'PGRST205', message: 'Could not find the table' });

  const { result } = await renderHook(() => useKbArticles(), { wrapper: withClient(client()) });

  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(articles).toHaveBeenCalledTimes(1);
});

test('a failed network is tried again, twice, as every list is', () => {
  const offline = new TypeError('Network request failed');

  expect(retryKnowledge(0, offline)).toBe(true);
  expect(retryKnowledge(1, offline)).toBe(true);
  expect(retryKnowledge(2, offline)).toBe(false);
  expect(retryKnowledge(0, { code: '42P01', message: 'relation does not exist' })).toBe(false);
});

test('no place, nothing asked', async () => {
  await renderHook(() => useKbPlace(null), { wrapper: withClient(client()) });

  expect(place).not.toHaveBeenCalled();
});

test('the place is read for this session only too', async () => {
  place.mockResolvedValue(null);
  const queries = client();

  const { result } = await renderHook(() => useKbPlace(42), { wrapper: withClient(queries) });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(place).toHaveBeenCalledWith(42);
  expect(queries.getQueryCache().find({ queryKey: knowledgeKeys.place(42) })?.meta).toEqual({
    persist: false,
  });
});
