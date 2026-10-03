import { translations, type Language } from '@str-ops/shared';
import Link from 'next/link';

import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NotFoundViewProps {
  /** The manager's language, read on the server (`lib/language.ts`). */
  language: Language;
}

/**
 * A page the panel does not have: a wrong address, or an id that is not one.
 * Rendered on the server, so the words come from the shared dictionary for
 * the language cookie rather than from the browser's i18n (CLAUDE.md: server
 * components do not import react-i18next).
 */
export function NotFoundView({ language }: NotFoundViewProps) {
  const { notFound, toDashboard } = translations[language].panel;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={notFound.title} description={notFound.text} />
      <Link href="/dashboard" className={cn(buttonVariants(), 'w-fit')}>
        {toDashboard}
      </Link>
    </div>
  );
}
