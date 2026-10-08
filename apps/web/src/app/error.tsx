'use client';

import { useTranslation } from 'react-i18next';

import { ErrorView, type RenderError } from '@/components/error-view';
import { Logo } from '@/components/logo';

interface RootErrorProps {
  error: RenderError;
  retry: () => void;
}

/**
 * An error the panel's own boundary cannot catch — one in the panel's layout,
 * or on the sign-in page: the same page outside the shell, under the logo. The
 * root layout (its providers, its theme) still stands around it.
 */
export default function RootError({ error, retry }: RootErrorProps) {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-6">
        <Logo alt={t('panel.title')} />
        <ErrorView error={error} retry={retry} />
      </div>
    </main>
  );
}
