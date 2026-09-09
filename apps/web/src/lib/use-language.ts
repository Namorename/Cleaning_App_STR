'use client';

import { FALLBACK_LANGUAGE, isSupportedLanguage, type Language } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

/** The language the panel is showing right now, for dates and names. */
export function useLanguage(): Language {
  const { i18n } = useTranslation();
  return isSupportedLanguage(i18n.language) ? i18n.language : FALLBACK_LANGUAGE;
}
