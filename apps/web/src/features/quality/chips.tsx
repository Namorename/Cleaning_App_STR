'use client';

import { TREND_MIN_STAYS, type ThemeState, type Tone, type TrustLevel } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { NO_VALUE } from '@/features/analytics/format';
import { formatShortDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import { isCompared, type ComparedTrend, type PlaceThemeLine, type ThemeLine } from './theme-model';

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

/** The states a table row names in words: its colour is not the only sign of them. */
const STATES_IN_WORDS: ReadonlySet<ThemeState> = new Set(['new', 'returned', 'in_work']);

const TREND_MARK: Readonly<Record<ComparedTrend, { arrow: string; tone: Tone }>> = {
  rising: { arrow: '↑', tone: 'overdue' },
  falling: { arrow: '↓', tone: 'done' },
  steady: { arrow: '→', tone: 'neutral' },
};

export function StateChip({ state }: { state: ThemeState }) {
  const { t } = useTranslation();
  return <Badge tone={STATE_TONE[state]}>{t(`panel.quality.state.${state}`)}</Badge>;
}

interface TrendMarkProps {
  line: Pick<ThemeLine, 'trend' | 'basis' | 'seam'>;
}

/** A trend as a chip with its arrow, or, grey and without one, why there is none (§6.4). */
export function TrendMark({ line }: TrendMarkProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { trend, basis, seam } = line;
  const label = t(`panel.quality.trend.${trend}`, {
    date: seam === null ? undefined : formatShortDay(seam, language),
  });

  if (isCompared(trend)) {
    const { arrow, tone } = TREND_MARK[trend];
    return (
      <Badge tone={tone}>
        <span aria-hidden="true">{arrow}</span>
        {label}
        <span className="sr-only"> {t(`panel.quality.trend.basis.${basis}`)}</span>
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

/**
 * A theme of a place's row: its name in its state's colour, the state in words
 * where it asks for an answer, the arrow of a trend if it has one. Each hidden
 * word opens with a space, or a screen reader runs it into the one before.
 */
export function ThemeChip({ line }: { line: PlaceThemeLine }) {
  const { t } = useTranslation();
  const { theme, state, trend, basis } = line;
  const stateText = t(`panel.quality.state.${state}`);

  return (
    <Badge tone={STATE_TONE[state]}>
      {t(`panel.quality.themes.${theme}`)}
      {STATES_IN_WORDS.has(state) ? (
        <span> · {stateText}</span>
      ) : (
        <span className="sr-only"> {stateText}</span>
      )}
      {isCompared(trend) ? (
        <>
          <span aria-hidden="true">{TREND_MARK[trend].arrow}</span>
          <span className="sr-only">
            {' '}
            {t(`panel.quality.trend.${trend}`)} {t(`panel.quality.trend.basis.${basis}`)}
          </span>
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
