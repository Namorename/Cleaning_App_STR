'use client';

import type { Language } from '@str-ops/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { initI18n } from '@/lib/i18n';

const STALE_TIME_MS = 30 * 1000;

interface ProvidersProps {
  language: Language;
  children: ReactNode;
}

/** Everything a page needs around it: the query cache and the dictionary. */
export function Providers({ language, children }: ProvidersProps) {
  const [i18n] = useState(() => initI18n(language));
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: STALE_TIME_MS, retry: 1 } },
      }),
  );

  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
}
