import { FALLBACK_LANGUAGE, isSupportedLanguage, type Language } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

/**
 * The language the app is showing right now, for names the manager typed.
 *
 * `currentLanguage()` answers the same question and is what modules outside
 * React use — but read from a component it is a quiet trap: it subscribes to
 * nothing, so the component redraws only if something else in it happens to be
 * subscribed. Two components relied on exactly that, with a comment explaining
 * the coincidence. This one subscribes on purpose.
 */
export function useLanguage(): Language {
  const { i18n } = useTranslation();
  return isSupportedLanguage(i18n.language) ? i18n.language : FALLBACK_LANGUAGE;
}
