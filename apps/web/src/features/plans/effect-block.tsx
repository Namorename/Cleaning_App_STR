'use client';

import { useTranslation } from 'react-i18next';

import { ErrorState, LoadingState } from '@/components/states';
import { formatNumber } from '@/features/analytics/format';
import { formatRate } from '@/features/quality/format';
import { formatDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import {
  EFFECT_MIN_STAYS,
  effectRows,
  hasEnoughStays,
  lastYearRate,
  type EffectRow,
  type EffectTheme,
} from './effect-model';
import { usePlanEffect } from './use-plans';

function RateCell({ rate, n, stays }: { rate: number | null; n: number; stays: number | null }) {
  const { t } = useTranslation();
  const language = useLanguage();

  return rate === null || stays === null ? (
    <span>{formatNumber(n, language)}</span>
  ) : (
    <span>
      {t('panel.quality.rate.value', {
        rate: formatRate(rate, language),
        n: formatNumber(n, language),
        stays: formatNumber(stays, language),
      })}
    </span>
  );
}

interface EffectThemeProps {
  theme: EffectTheme;
  staysBefore: number | null;
  staysAfter: number;
}

function RowLine({ row, staysBefore, staysAfter }: { row: EffectRow } & Omit<EffectThemeProps, 'theme'>) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-[8rem_1fr_1fr]">
      <dt className="text-muted-foreground">{t(`panel.plans.effect.layer.${row.layer}`)}</dt>
      <dd>
        <span className="text-muted-foreground">{t('panel.plans.effect.before')}: </span>
        <RateCell rate={row.rateBefore} n={row.before} stays={staysBefore} />
      </dd>
      <dd>
        <span className="text-muted-foreground">{t('panel.plans.effect.after')}: </span>
        <RateCell rate={row.rateAfter} n={row.after} stays={staysAfter} />
      </dd>
    </div>
  );
}

function ThemeEffect({ theme, staysBefore, staysAfter }: EffectThemeProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const rows = effectRows(theme, staysBefore, staysAfter);
  const yearRate = lastYearRate(theme);
  const name = t(`panel.quality.themes.${theme.theme}`, { defaultValue: theme.theme });

  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-lg border p-3 text-sm">
      <h3 className="font-medium break-words">{name}</h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('panel.plans.effect.silent')}</p>
      ) : (
        <dl className="flex flex-col gap-1">
          {rows.map((row) => (
            <RowLine key={row.layer} row={row} staysBefore={staysBefore} staysAfter={staysAfter} />
          ))}
        </dl>
      )}
      <p className="text-muted-foreground">
        {t('panel.plans.effect.work', { n: formatNumber(theme.work_after, language) })}
      </p>
      {theme.seasonal ? (
        <p className="text-xs text-muted-foreground">
          {yearRate === null
            ? t('panel.plans.effect.seasonalNoData')
            : t('panel.plans.effect.seasonal', { rate: formatRate(yearRate, language) })}
        </p>
      ) : null}
    </li>
  );
}

/**
 * What followed a finished plan (§5.6): the same themes and layers, before and after. It says
 * what came together with what, and never that the plan did it (§3.4).
 */
export function EffectBlock({ planId }: { planId: string }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const read = usePlanEffect(planId);

  if (read.isError) {
    return <ErrorState message={t('panel.plans.effect.loadError')} error={read.error} />;
  }
  if (read.data === undefined) {
    return <LoadingState>{t('common.loading')}</LoadingState>;
  }
  if (read.data === null) {
    return null;
  }

  const effect = read.data;
  return (
    <section
      aria-label={t('panel.plans.effect.title')}
      className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <h2 className="text-base font-semibold">{t('panel.plans.effect.title')}</h2>
      <p className="text-sm text-muted-foreground">
        {t('panel.plans.effect.since', {
          day: formatDay(effect.closed_on, language),
          stays: formatNumber(effect.stays_after, language),
        })}
      </p>
      {hasEnoughStays(effect) ? (
        <>
          <ul className="flex flex-col gap-2">
            {effect.themes.map((theme) => (
              <ThemeEffect
                key={theme.theme}
                theme={theme}
                staysBefore={effect.stays_before}
                staysAfter={effect.stays_after}
              />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t('panel.plans.effect.note')}</p>
        </>
      ) : (
        <p className="text-sm">
          {t('panel.plans.effect.few', {
            stays: formatNumber(effect.stays_after, language),
            min: EFFECT_MIN_STAYS,
          })}
        </p>
      )}
    </section>
  );
}
