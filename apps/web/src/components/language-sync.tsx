'use client';

import type { Language } from '@str-ops/shared';
import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface LanguageSyncProps {
  /** The language the server rendered the panel's shell in: the `lang` cookie. */
  language: Language;
}

/**
 * Keeps the open page in the language the server rendered its shell in.
 *
 * The dictionary is made once per browser tab, from the cookie of the first
 * page (`app/providers.tsx`), and a page entered without a reload keeps it.
 * The sign-in is such an entry: it sets the cookie from the person's profile
 * and moves on into the panel, whose shell the server renders afresh with the
 * new cookie. A refresh after a choice in «Настройки» renders it again, by
 * then in the language already on screen, and nothing happens.
 *
 * A layout effect, so the switch lands before the page is painted.
 */
export function LanguageSync({ language }: LanguageSyncProps) {
  const { i18n } = useTranslation();

  useLayoutEffect(() => {
    if (i18n.language !== language) {
      document.documentElement.lang = language;
      void i18n.changeLanguage(language);
    }
  }, [i18n, language]);

  return null;
}
