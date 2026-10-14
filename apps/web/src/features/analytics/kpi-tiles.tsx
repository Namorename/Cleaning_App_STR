'use client';

import type { Language } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/use-language';

import {
  changeOf,
  formatChange,
  formatNumber,
  formatPercent,
  NO_VALUE,
  type Better,
  type Change,
} from './format';
import type { Summary } from './schema';

const PENDING = '…';

type Translate = (key: string, values?: Record<string, unknown>) => string;

interface TileSpec {
  key: string;
  value: (summary: Summary) => number | null;
  /** How the figure reads on the tile. */
  show: (value: number | null, language: Language, t: Translate) => string;
  /** A count moves relatively; a share in points. */
  change: Change['kind'];
  better: Better;
  hint?: (summary: Summary, language: Language, t: Translate) => string;
}

const KEY = 'panel.analytics.tiles.';

const count = (value: number | null, language: Language) => formatNumber(value, language);
const minutes = (value: number | null, language: Language, t: Translate) =>
  value === null ? NO_VALUE : t('panel.analytics.value.minutes', { value: formatNumber(value, language) });

/** The owner's key figures (2026-10-14), in the order he named them. */
const TILES: readonly TileSpec[] = [
  {
    key: 'cleaningsDone',
    value: (s) => s.cleanings_done,
    show: count,
    change: 'relative',
    better: 'up',
    hint: (s, language, t) =>
      `${t(`${KEY}cleaningsDoneHint`)} · ${t(`${KEY}midstay`, { count: formatNumber(s.cleanings_done_midstay, language) })}`,
  },
  {
    key: 'cleaningsPlanned',
    value: (s) => s.cleanings_planned,
    show: count,
    change: 'relative',
    better: 'none',
    hint: (_s, _language, t) => t(`${KEY}cleaningsPlannedHint`),
  },
  {
    key: 'checkouts',
    value: (s) => s.checkouts,
    show: count,
    change: 'relative',
    better: 'up',
    hint: (s, language, t) =>
      t(`${KEY}roomsReleased`, { count: formatNumber(s.rooms_released, language) }),
  },
  {
    key: 'problemsResolved',
    value: (s) => s.problems_resolved,
    show: count,
    change: 'relative',
    better: 'up',
  },
  {
    key: 'problemsOpen',
    value: (s) => s.problems_open,
    show: count,
    change: 'relative',
    better: 'down',
    hint: (_s, _language, t) => t(`${KEY}problemsOpenHint`),
  },
  {
    key: 'urgencyAvg',
    value: (s) => s.urgency_avg,
    show: (value, language) => formatNumber(value, language, 2),
    change: 'relative',
    better: 'none',
    hint: (_s, _language, t) => t(`${KEY}urgencyHint`),
  },
  {
    key: 'cleaningMinutesMedian',
    value: (s) => s.cleaning_minutes_median,
    show: minutes,
    change: 'relative',
    better: 'none',
    hint: (s, language, t) =>
      t(`${KEY}cleaningMinutesHint`, { value: minutes(s.cleaning_minutes_avg, language, t) }),
  },
  {
    key: 'photoShare',
    value: (s) => s.photo_share,
    show: (value, language) => formatPercent(value, language),
    change: 'points',
    better: 'up',
  },
  {
    key: 'occupancy',
    value: (s) => s.occupancy,
    show: (value, language) => formatPercent(value, language),
    change: 'points',
    better: 'up',
    hint: (s, language, t) =>
      t(`${KEY}occupancyHint`, {
        occupied: formatNumber(s.occupied_nights, language),
        available: formatNumber(s.available_nights, language),
      }),
  },
];

interface KpiTilesProps {
  current: Summary | undefined;
  /** The previous period's figures; null when the comparison is off. */
  previous: Summary | undefined | null;
}

/** The key figures of the period, each beside its change against the period before. */
export function KpiTiles({ current, previous }: KpiTilesProps) {
  const { t } = useTranslation();
  const language = useLanguage();

  return (
    <section aria-label={t(`${KEY}label`)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {TILES.map((tile) => {
        const value = current === undefined ? undefined : tile.value(current);
        const change =
          value === undefined || previous === null
            ? undefined
            : previous === undefined
              ? undefined
              : changeOf(value, tile.value(previous), tile.change, tile.better);
        return (
          <div
            key={tile.key}
            className="flex flex-col gap-1 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10"
          >
            <span className="text-sm text-muted-foreground">{t(`${KEY}${tile.key}`)}</span>
            <span className="text-3xl font-semibold tabular-nums">
              {value === undefined ? PENDING : tile.show(value, language, t)}
            </span>
            {previous === null || change === undefined ? null : (
              <ChangeLine change={change} />
            )}
            {current === undefined || tile.hint === undefined ? null : (
              <span className="text-xs text-muted-foreground">{tile.hint(current, language, t)}</span>
            )}
          </div>
        );
      })}
    </section>
  );
}

const ARROW: Record<Change['direction'], string> = { up: '↑', down: '↓', flat: '→' };

/** The change in words and an arrow: the colour is never the only sign of it. */
function ChangeLine({ change }: { change: Change | null }) {
  const { t } = useTranslation();
  const language = useLanguage();
  if (change === null) {
    return <span className="text-xs text-muted-foreground">{t('panel.analytics.change.none')}</span>;
  }
  const number = formatChange(change, language);
  const text = change.kind === 'points' ? t('panel.analytics.change.points', { value: number }) : number;
  return (
    <span
      className={cn(
        'text-sm font-medium tabular-nums',
        change.tone === 'bad' && 'text-destructive',
        change.tone === 'good' && 'text-primary',
        change.tone === 'neutral' && 'text-muted-foreground',
      )}
    >
      {/* Read aloud whole, with what the number is about; seen as arrow and number. */}
      <span className="sr-only">{t('panel.analytics.change.label', { value: text })}</span>
      <span aria-hidden="true">
        {ARROW[change.direction]} {text}
      </span>
    </span>
  );
}
