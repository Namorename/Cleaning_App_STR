'use client';

import { SUPPORTED_LANGUAGES } from '@str-ops/shared';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { StepWords } from './draft-model';

/**
 * The title of a proposed step: the manager's language, and each language for the people the
 * step reaches. Titles the manager types carry no translations.
 */
export function useStepWords(): StepWords {
  const { t, i18n } = useTranslation();
  const said = (fixed: TFunction, kind: string, theme: string) =>
    fixed(`panel.plans.templates.${kind}`, { theme: fixed(`panel.quality.themes.${theme}`) });

  return (kind, theme) => ({
    title: said(t, kind, theme),
    title_i18n: Object.fromEntries(
      SUPPORTED_LANGUAGES.map((language) => [
        language,
        said(i18n.getFixedT(language), kind, theme),
      ]),
    ),
  });
}
