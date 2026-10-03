import { cookies } from 'next/headers';

import { NotFoundView } from '@/components/not-found-view';
import { LANGUAGE_COOKIE, languageFromCookie } from '@/lib/language';

/**
 * A page of the panel that is not there — an address it has no page for
 * (`[...missing]`) or an id that is not one (`notFound()` in a page) — inside
 * the shell, so the menu still leads everywhere, in the manager's language.
 */
export default async function PanelNotFound() {
  const language = languageFromCookie((await cookies()).get(LANGUAGE_COOKIE)?.value);

  return <NotFoundView language={language} />;
}
