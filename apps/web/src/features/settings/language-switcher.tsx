'use client';

import { isSupportedLanguage } from '@str-ops/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { PANEL_LANGUAGES } from '@/lib/language';
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
 * in any other browser. Only once the profile has it does the panel change
 * (`useSaveMyLanguage`, which does it even if this page is left meanwhile).
 * A refusal changes nothing and says so.
 *
 * While the save is on its way the select says it is busy rather than being
 * `disabled`: a control disabled under the hand drops the keyboard's focus to
 * the page. A second choice then is not sent, and the first one stays shown.
 */
export function LanguageSwitcher({ userId }: LanguageSwitcherProps) {
  const { t } = useTranslation();
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
    save.mutate({ userId, language: value });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{t('panel.settings.language.label')}</Label>
      <NativeSelect
        id={id}
        className="self-start aria-disabled:cursor-progress aria-disabled:opacity-50"
        value={shown}
        aria-disabled={save.isPending ? true : undefined}
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
