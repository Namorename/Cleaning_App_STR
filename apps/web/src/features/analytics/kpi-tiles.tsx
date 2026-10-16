'use client';

import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/use-language';

import { changeOf, formatChange, type Change } from './format';
import { TILE_KEY as KEY, TILES } from './kpi-spec';
import type { Summary } from './schema';

const PENDING = '…';

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
