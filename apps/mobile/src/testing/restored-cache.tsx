import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
  hydrate,
  type DehydratedState,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * A client whose cache came back from disk the way the app restores it:
 * dehydrated, written as JSON, read back and hydrated. zod never sees it, so
 * a test can hand it the shape an older build saved (docs/chat-plan.md).
 * gcTime Infinity schedules no collection timer, so nothing holds the worker.
 */
export function restoredFromDisk(key: readonly unknown[], data: unknown): QueryClient {
  const options = { defaultOptions: { queries: { retry: false, gcTime: Infinity } } };
  const before = new QueryClient(options);
  before.setQueryData(key, data);
  // The persister's own round trip: whatever shape went in comes back untyped.
  const onDisk = JSON.parse(JSON.stringify(dehydrate(before))) as DehydratedState;
  before.clear();

  const client = new QueryClient(options);
  hydrate(client, onDisk);
  return client;
}

export function withClient(client: QueryClient) {
  return function ClientWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
