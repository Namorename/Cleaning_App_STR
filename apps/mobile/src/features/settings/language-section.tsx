import { useTranslation } from 'react-i18next';

import { SegmentedTabs } from '@/components/segmented-tabs';
import { useLanguage } from '@/hooks/use-language';
import type { Language } from '@/i18n';

import { FailureNote, SettingsSection, failureOf } from './section';
import { useChangeLanguage } from './use-settings';

/**
 * The languages on offer, in the order the panel lists them to the manager.
 * Each is named in its own language: a cleaner stuck in one she cannot read
 * still finds hers.
 */
export const LANGUAGE_CHOICES = ['ru', 'en', 'cs'] as const satisfies readonly Language[];

/**
 * Her language, chosen by herself. It is the same field the manager sets in
 * the panel (`profiles.preferred_language`), so there is one answer to "what
 * does she read" and it is whoever chose last.
 */
export function LanguageSection() {
  const { t } = useTranslation();
  const language = useLanguage();
  const change = useChangeLanguage();
  const options = LANGUAGE_CHOICES.map((code) => ({
    value: code,
    label: t(`common.languages.${code}`),
  }));

  return (
    <SettingsSection title={t('settings.language.heading')}>
      <SegmentedTabs
        semantics="radio"
        accessibilityLabel={t('settings.language.heading')}
        options={options}
        value={language}
        onChange={(next) => change.mutate(next)}
        // One change at a time: a second tap while the first is being saved
        // would leave a refusal nothing sensible to go back to.
        isDisabled={change.isPending}
      />
      {change.isError ? (
        <FailureNote failure={failureOf(change.error, 'settings.language.saveFailed')} />
      ) : null}
    </SettingsSection>
  );
}
