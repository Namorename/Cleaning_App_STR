'use client';

import { RATE_MIN_STAYS } from '@str-ops/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatNumber } from '@/features/analytics/format';
import { formatShortDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import { StateChip, TrendMark } from './chips';
import { formatRate } from './format';
import { QUALITY_LAYERS, type PlaceThemeLine, type ThemeLine } from './theme-model';

/** «3 жалобы · 2 находки · 1 заведено»: each layer on its own, never one sum (§2.3). */
function LayersText({ layers }: Pick<ThemeLine, 'layers'>) {
  const { t } = useTranslation();
  const said = QUALITY_LAYERS.filter((layer) => layers[layer] > 0).map((layer) =>
    t(`panel.quality.layers.${layer}`, { count: layers[layer] }),
  );
  return <p>{said.length === 0 ? t('panel.quality.layers.none') : said.join(' · ')}</p>;
}

/** A rate always beside the numbers it is made of; or why the count stands alone. */
function RateText({ rates, rateGap }: Pick<ThemeLine, 'rates' | 'rateGap'>) {
  const { t } = useTranslation();
  const language = useLanguage();

  if (rateGap !== null) {
    return (
      <p className="text-xs text-muted-foreground">
        {t(`panel.quality.rate.gap.${rateGap}`, { min: RATE_MIN_STAYS })}
      </p>
    );
  }
  return rates.map(({ layer, episodes, stays, rate }) => (
    <p key={layer} className="text-muted-foreground">
      {t(`panel.quality.rate.layer.${layer}`)}{' '}
      <span className="text-foreground">
        {t('panel.quality.rate.value', {
          rate: formatRate(rate, language),
          n: formatNumber(episodes, language),
          stays: formatNumber(stays, language),
        })}
      </span>
    </p>
  ));
}

interface ThemeFrameProps {
  line: ThemeLine;
  /** Before the theme's name: a place's state. */
  lead?: ReactNode;
  /** Under its numbers: a place's work. */
  children?: ReactNode;
}

function ThemeFrame({ line, lead, children }: ThemeFrameProps) {
  const { t } = useTranslation();
  // A group's and the portfolio's trend reads the window before, with the same
  // words a place shows instead of one (§3.3).
  const isSeasonalAside = line.seasonal && line.trend !== 'seasonal' && line.trend !== 'hidden';

  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {lead}
        <h3 className="font-medium break-words">{t(`panel.quality.themes.${line.theme}`)}</h3>
        <TrendMark trend={line.trend} />
        {isSeasonalAside ? (
          <span className="text-xs text-muted-foreground">{t('panel.quality.trend.seasonal')}</span>
        ) : null}
      </div>
      <LayersText layers={line.layers} />
      <RateText rates={line.rates} rateGap={line.rateGap} />
      {children}
    </li>
  );
}

/** A theme of a group or of the portfolio: nobody's to answer, so without a state. */
export function ScopeThemeItem({ line }: { line: ThemeLine }) {
  return <ThemeFrame line={line} />;
}

/** A theme of a place, with what was done about it (§2.3: the fourth layer, an answer). */
export function PlaceThemeItem({ line }: { line: PlaceThemeLine }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { openWork, closedOn } = line;

  return (
    <ThemeFrame line={line} lead={<StateChip state={line.state} />}>
      {openWork > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('panel.quality.work.open', { n: openWork })}
        </p>
      ) : null}
      {closedOn === null ? null : (
        <p className="text-xs text-muted-foreground">
          {t('panel.quality.work.closed', { day: formatShortDay(closedOn, language) })}
        </p>
      )}
    </ThemeFrame>
  );
}
