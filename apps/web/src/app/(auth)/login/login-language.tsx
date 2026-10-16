'use client';

import type { Language } from '@str-ops/shared';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { applyLanguageChoice, PANEL_LANGUAGES } from '@/lib/language';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

/**
 * The sign-in page's language, chosen before anybody is known: English,
 * Čeština, Русский — each in its own words and its own `lang`, so a guest who
 * cannot read the language on screen still finds hers.
 *
 * A guest has no profile to keep the choice in, so it is this browser's: the
 * `lang` cookie the root layout reads on every page. The sign-in then puts the
 * profile's language over it, when the profile keeps one (`actions.ts`).
 *
 * Buttons, not a select: all three names stay in sight, which is the point
 * for somebody who reads none of the others.
 */
export function LoginLanguage() {
  const { t, i18n } = useTranslation();
  const language = useLanguage();

  const choose = (code: Language) => {
    if (code === language) {
      return;
    }
    applyLanguageChoice(document, code);
    void i18n.changeLanguage(code);
  };

  return (
    <div
      role="group"
      aria-label={t('panel.login.language')}
      className="flex flex-wrap items-center justify-center gap-1"
    >
      <Globe className="size-4 text-muted-foreground" aria-hidden="true" />
      {PANEL_LANGUAGES.map((code) => {
        const isCurrent = code === language;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={isCurrent}
            onClick={() => choose(code)}
            className={cn(
              'min-h-11 rounded-md px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-9',
              isCurrent
                ? 'font-semibold text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t(`common.languages.${code}`)}
          </button>
        );
      })}
    </div>
  );
}
