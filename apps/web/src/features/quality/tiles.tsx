'use client';

import { useTranslation } from 'react-i18next';

import { formatNumber } from '@/features/analytics/format';
import { useLanguage } from '@/lib/use-language';

import { formatRating } from './format';
import type { OverviewTiles } from './view-model';

interface TileProps {
  label: string;
  value: string;
  hint?: string | null;
}

function Tile({ label, value, hint }: TileProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
      {hint === undefined || hint === null ? null : (
        <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

interface PortfolioTilesProps {
  tiles: OverviewTiles;
  /** A short window reads three months of ratings: said under them. */
  ratingNote: string | null;
}

/** The portfolio's figures of the window, whatever the table is narrowed to. */
export function PortfolioTiles({ tiles, ratingNote }: PortfolioTilesProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const average =
    tiles.average === null
      ? t('panel.quality.tiles.noRatings')
      : t('panel.quality.tiles.average', { average: formatRating(tiles.average, language) });

  return (
    <section
      aria-label={t('panel.quality.tiles.label')}
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      <Tile label={t('panel.quality.tiles.stays')} value={formatNumber(tiles.stays, language)} />
      <Tile
        label={t('panel.quality.tiles.rated')}
        value={formatNumber(tiles.rated, language)}
        hint={ratingNote === null ? average : `${average} · ${ratingNote}`}
      />
      <Tile
        label={t('panel.quality.tiles.newThemes')}
        value={formatNumber(tiles.newThemes, language)}
      />
      <Tile
        label={t('panel.quality.tiles.returned')}
        value={formatNumber(tiles.returnedThemes, language)}
      />
    </section>
  );
}
