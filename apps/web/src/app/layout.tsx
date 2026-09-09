import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { LANGUAGE_COOKIE, languageFromCookie } from '@/lib/language';

import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'STR Ops',
  description: 'Manager panel',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const language = languageFromCookie(cookieStore.get(LANGUAGE_COOKIE)?.value);

  return (
    <html lang={language} className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers language={language}>{children}</Providers>
      </body>
    </html>
  );
}
