'use client';

import { isSupportedLanguage } from '@str-ops/shared';
import { useRouter } from 'next/navigation';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { applyLanguageChoice, PANEL_LANGUAGES } from '@/lib/language';
import { serverErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import { useSaveMyLanguage } from './use-settings';

interface LanguageSwitcherProps {
  /** The signed-in person, whose profile keeps the choice. */
  userId: string;
}

/**
 * The panel's language: Русский, English, Čeština — each in its own words.
 *
 * The choice is the person's, not this browser's: it is written to her
 * profile first, the same column the phone writes, and the sign-in applies it
 * in any other browser. Only once the profile has it does the panel change —
 * the cookie for the server's pages, <html lang>, the dictionary, and a
 * refresh for what the server renders. A refusal changes nothing and says so.
 */
export function LanguageSwitcher({ userId }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const save = useSaveMyLanguage();
  const id = useId();
  const hintId = `${id}-hint`;

  // The choice on its way stays shown; a refused one falls back to the language on screen.
  const shown = save.isPending ? (save.variables?.language ?? language) : language;
  const failure = save.isError ? serverErrorText(save.error) : null;

  const choose = (value: string) => {
    if (!isSupportedLanguage(value) || value === language || save.isPending) {
      return;
    }
    save.mutate(
      { userId, language: value },
      {
        onSuccess: () => {
          applyLanguageChoice(document, value);
          void i18n.changeLanguage(value);
          router.refresh();
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{t('panel.settings.language.label')}</Label>
      <NativeSelect
        id={id}
        className="self-start"
        value={shown}
        disabled={save.isPending}
        aria-describedby={hintId}
        onChange={(event) => choose(event.target.value)}
      >
        {PANEL_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {t(`common.languages.${code}`)}
          </option>
        ))}
      </NativeSelect>
      <p id={hintId} className="text-xs text-muted-foreground">
        {t('panel.settings.language.hint')}
      </p>

      {failure === null ? null : (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-sm text-destructive">
            {t('panel.settings.language.saveFailed')} {failure.text}
          </p>
          {failure.detail === null ? null : (
            <p className="text-xs text-muted-foreground">{failure.detail}</p>
          )}
        </div>
      )}

      {save.isPending ? (
        <span role="status" className="text-sm text-muted-foreground">
          {t('panel.settings.saving')}
        </span>
      ) : null}
    </div>
  );
}
