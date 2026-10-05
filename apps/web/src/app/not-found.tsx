import { translations } from '@str-ops/shared';
import { cookies } from 'next/headers';

import { Logo } from '@/components/logo';
import { NotFoundView } from '@/components/not-found-view';
import { LANGUAGE_COOKIE, languageFromCookie } from '@/lib/language';

/**
 * The root 404, for whatever does not reach the panel's own (`(panel)/
 * not-found.tsx`): the same page outside the shell, under the logo, as the
 * sign-in card stands — no longer Next's English one.
 */
export default async function RootNotFound() {
  const language = languageFromCookie((await cookies()).get(LANGUAGE_COOKIE)?.value);

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-6">
        <Logo alt={translations[language].panel.title} />
        <NotFoundView language={language} />
      </div>
    </main>
  );
}
