'use client';

import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/states';
import { formatNumber } from '@/features/analytics/format';
import { useLanguage } from '@/lib/use-language';

import { ScopeThemeItem } from './theme-line';
import type { ScopeView } from './view-model';

interface ScopeBlockProps {
  title: string;
  scope: ScopeView;
}

/** The themes said most of a group of places, or of all of them. */
export function ScopeBlock({ title, scope }: ScopeBlockProps) {
  const { t } = useTranslation();
  const language = useLanguage();

  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">
        {t('panel.quality.scope.summary', {
          count: scope.places,
          stays: formatNumber(scope.stays, language),
        })}
      </p>
      {scope.hasThemes ? (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {scope.themes.map((line) => (
            <ScopeThemeItem key={line.theme} line={line} />
          ))}
        </ul>
      ) : (
        <EmptyState>{t('panel.quality.scope.noThemes')}</EmptyState>
      )}
    </section>
  );
}
