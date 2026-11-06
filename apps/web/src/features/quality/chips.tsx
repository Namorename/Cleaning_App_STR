'use client';

import { TREND_MIN_STAYS, type ThemeState, type Tone, type TrustLevel } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { NO_VALUE } from '@/features/analytics/format';

import type { PlaceThemeLine, ThemeTrend } from './theme-model';

/** What nobody has answered stands out; the rest stays quiet. */
const STATE_TONE: Readonly<Record<ThemeState, Tone>> = {
  returned: 'overdue',
  new: 'urgent',
  in_work: 'inProgress',
  fixed: 'done',
  single: 'neutral',
  no_repair_data: 'notHappened',
  quiet: 'neutral',
};

type ShownTrend = Extract<ThemeTrend, 'rising' | 'falling' | 'steady'>;

const TREND_MARK: Readonly<Record<ShownTrend, { arrow: string; tone: Tone }>> = {
  rising: { arrow: '↑', tone: 'overdue' },
  falling: { arrow: '↓', tone: 'done' },
  steady: { arrow: '→', tone: 'neutral' },
};

function isShown(trend: ThemeTrend): trend is ShownTrend {
  return Object.hasOwn(TREND_MARK, trend);
}

export function StateChip({ state }: { state: ThemeState }) {
  const { t } = useTranslation();
  return <Badge tone={STATE_TONE[state]}>{t(`panel.quality.state.${state}`)}</Badge>;
}

/** A trend as a chip with its arrow, or, grey and without one, why there is none (§6.4). */
export function TrendMark({ trend }: { trend: ThemeTrend }) {
  const { t } = useTranslation();
  const label = t(`panel.quality.trend.${trend}`);

  if (isShown(trend)) {
    const { arrow, tone } = TREND_MARK[trend];
    return (
      <Badge tone={tone}>
        <span aria-hidden="true">{arrow}</span>
        {label}
      </Badge>
    );
  }
  if (trend === 'too_little') {
    return (
      <>
        <Badge tone="neutral">{label}</Badge>
        <span className="text-xs text-muted-foreground">
          {t('panel.quality.trend.tooLittleHint', { min: TREND_MIN_STAYS })}
        </span>
      </>
    );
  }
  return <span className="text-xs text-muted-foreground">{label}</span>;
}

/** A theme of a place's row: its name in its state's colour, the arrow of a trend if it has one. */
export function ThemeChip({ line }: { line: PlaceThemeLine }) {
  const { t } = useTranslation();
  const { theme, state, trend } = line;

  return (
    <Badge tone={STATE_TONE[state]}>
      {t(`panel.quality.themes.${theme}`)}
      <span className="sr-only">{t(`panel.quality.state.${state}`)}</span>
      {isShown(trend) ? (
        <>
          <span aria-hidden="true">{TREND_MARK[trend].arrow}</span>
          <span className="sr-only">{t(`panel.quality.trend.${trend}`)}</span>
        </>
      ) : null}
    </Badge>
  );
}

/** How much a place's numbers can carry; unknown while its stays are not all there. */
export function TrustChip({ level }: { level: TrustLevel | null }) {
  const { t } = useTranslation();
  return level === null ? (
    <span className="text-muted-foreground">{NO_VALUE}</span>
  ) : (
    <Badge tone="neutral">{t(`panel.quality.trust.${level}`)}</Badge>
  );
}
