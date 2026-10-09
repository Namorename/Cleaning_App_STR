import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SegmentedTabs } from '@/components/segmented-tabs';
import type { ServerErrorText } from '@/lib/server-error';
import { reportError } from '@/lib/sentry';
import {
  THEME_PREFERENCES,
  chooseThemePreference,
  useThemePreference,
  type ThemePreference,
} from '@/lib/theme-preference';

import { FailureNote, SettingsSection, failureOf } from './section';

/**
 * Her theme: as the system, light or dark (owner's decision 6). Applied at
 * once and kept on this phone only — the street is a reason to choose light,
 * and that is her phone's business, not her profile's. A choice that could not
 * be kept still holds until the app closes, and the section says so.
 */
export function ThemeSection() {
  const { t } = useTranslation();
  const preference = useThemePreference();
  const [failure, setFailure] = useState<ServerErrorText | null>(null);
  const options = THEME_PREFERENCES.map((value) => ({
    value,
    label: t(`common.theme.${value}`),
  }));

  const onChange = (next: ThemePreference) => {
    setFailure(null);
    chooseThemePreference(next).catch((error: unknown) => {
      reportError(error);
      setFailure(failureOf(error, 'settings.theme.saveFailed'));
    });
  };

  return (
    <SettingsSection title={t('common.theme.label')} hint={t('settings.theme.hint')}>
      <SegmentedTabs
        semantics="radio"
        accessibilityLabel={t('common.theme.label')}
        options={options}
        value={preference}
        onChange={onChange}
      />
      {failure !== null ? <FailureNote failure={failure} /> : null}
    </SettingsSection>
  );
}
