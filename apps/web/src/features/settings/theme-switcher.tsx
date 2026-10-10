'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  applyThemeChoice,
  isThemeChoice,
  onThemeChoice,
  shownThemeChoice,
  THEME_CHOICES,
  type ThemeChoice,
} from '@/lib/theme';

interface ThemeSwitcherProps {
  /** The choice the server read from the cookie. */
  initial: ThemeChoice;
}

/**
 * «Как в системе / Светлая / Тёмная» (decision 6). A choice repaints the panel
 * at once and is kept in this browser's cookie for every page after.
 */
export function ThemeSwitcher({ initial }: ThemeSwitcherProps) {
  const { t } = useTranslation();
  // Back on the page after the lever was pressed: the choice made since, not the cached one.
  const [choice, setChoice] = useState<ThemeChoice>(() =>
    typeof document === 'undefined' ? initial : shownThemeChoice(document, initial),
  );
  const id = useId();

  // The lever in the menu is the same setting: what it chooses shows here.
  useEffect(() => onThemeChoice(document, setChoice), []);

  const choose = (value: string) => {
    if (!isThemeChoice(value)) {
      return;
    }
    setChoice(value);
    applyThemeChoice(document, value);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{t('common.theme.label')}</Label>
      <NativeSelect
        id={id}
        className="self-start"
        value={choice}
        onChange={(event) => choose(event.target.value)}
      >
        {THEME_CHOICES.map((one) => (
          <option key={one} value={one}>
            {t(`common.theme.${one}`)}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
