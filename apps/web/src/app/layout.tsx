import type { Metadata } from 'next';
import { Nunito } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';

import { documentLanguage, LANGUAGE_COOKIE, languageFromCookie } from '@/lib/language';
import { PAGE_LANGUAGE_HEADER } from '@/lib/page-language';
import { THEME_COOKIE, themeClass, themeFromCookie } from '@/lib/theme';
import { cn } from '@/lib/utils';

import { Providers } from './providers';
import './globals.css';

/**
 * Nunito, as the tokens say (`FONT`: the family and its four weights; a test
 * holds this call to them — next/font takes literal options only), with the
 * Cyrillic and the Czech letters. Next downloads the files at build time and
 * serves them from the panel: the browser never asks Google. The variable sits
 * on <html>, where `font-sans` is read (globals.css).
 */
const nunito = Nunito({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

/** The tab reads the panel's name, «woom» in every language — as `panel.title` does (decision 8). */
export const metadata: Metadata = {
  title: 'woom',
  description: 'Manager panel',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const languageCookie = cookieStore.get(LANGUAGE_COOKIE)?.value;
  const language = languageFromCookie(languageCookie);
  const theme = themeFromCookie(cookieStore.get(THEME_COOKIE)?.value);
  // The public privacy page speaks its address's language, which the proxy
  // forwards; the panel's own strings stay in the manager's language.
  const pageLanguage = (await headers()).get(PAGE_LANGUAGE_HEADER);

  return (
    <html
      lang={documentLanguage(pageLanguage, languageCookie)}
      className={cn('h-full antialiased', nunito.variable, themeClass(theme))}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers language={language}>{children}</Providers>
      </body>
    </html>
  );
}
