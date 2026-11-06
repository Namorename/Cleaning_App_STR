'use client';

import { useTranslation } from 'react-i18next';

import { niceMax, share, ticks } from '@/features/analytics/charts/geometry';
import { useLanguage } from '@/lib/use-language';

import { formatLongMonth, formatShortMonth } from './format';
import { QUALITY_LAYERS, type QualityLayer } from './theme-model';
import type { MonthBar } from './view-model';

/** Written out whole: Tailwind finds a class only where its full name stands in the source. */
const LAYER_COLOUR: Readonly<Record<QualityLayer, { fill: string; swatch: string }>> = {
  reviews: { fill: 'fill-[var(--chart-1)]', swatch: 'bg-[var(--chart-1)]' },
  found: { fill: 'fill-[var(--chart-3)]', swatch: 'bg-[var(--chart-3)]' },
  reported: { fill: 'fill-[var(--chart-4)]', swatch: 'bg-[var(--chart-4)]' },
};

const HEIGHT = 160;
const AXIS = 28;
const BOTTOM = 20;
const TOP_GAP = 8;
const SLOT = 40;
const BAR = 10;
const BAR_GAP = 2;

/** Three thin bars side by side: stacked, their height would read as the sum of the layers. */
function barX(slot: number, at: number): number {
  const group = QUALITY_LAYERS.length * (BAR + BAR_GAP) - BAR_GAP;
  return slot + (SLOT - group) / 2 + at * (BAR + BAR_GAP);
}

interface MonthChartProps {
  bars: readonly MonthBar[];
}

/**
 * The place's year by month, a bar per layer. The figure is the same numbers
 * as the table under it, which is what a screen reader gets, and the title of
 * each month is what a mouse gets.
 */
export function MonthChart({ bars }: MonthChartProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const title = t('panel.quality.months.title');
  const name = (layer: QualityLayer) => t(`panel.quality.months.layer.${layer}`);

  if (bars.length === 0) {
    return (
      <figure className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <figcaption className="text-sm font-medium">{title}</figcaption>
        <p className="text-sm text-muted-foreground">{t('panel.quality.months.empty')}</p>
      </figure>
    );
  }

  const top = niceMax(
    Math.max(...bars.flatMap((bar) => QUALITY_LAYERS.map((layer) => bar[layer]))),
  );
  const width = AXIS + bars.length * SLOT;
  const plot = HEIGHT - BOTTOM;
  const describe = (bar: MonthBar) =>
    [
      formatLongMonth(bar.month, language),
      ...QUALITY_LAYERS.map((layer) => `${name(layer)}: ${bar[layer]}`),
    ].join(', ');

  return (
    <figure className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <div className="min-w-0 overflow-x-auto">
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="xMinYMid meet"
          className="max-w-none"
          style={{ width, height: HEIGHT }}
        >
          {ticks(top).map((tick) => {
            const y = plot - share(tick, top) * (plot - TOP_GAP);
            return (
              <g key={tick}>
                <line x1={AXIS} x2={width} y1={y} y2={y} className="stroke-foreground/10" />
                <text
                  x={AXIS - 4}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px]"
                >
                  {tick}
                </text>
              </g>
            );
          })}
          {bars.map((bar, index) => {
            const slot = AXIS + index * SLOT;
            return (
              <g key={bar.month}>
                <title>{describe(bar)}</title>
                {/* The whole slot answers the mouse, not only a thin bar. */}
                <rect
                  x={slot}
                  y={0}
                  width={SLOT}
                  height={plot}
                  className="fill-transparent hover:fill-muted/60"
                />
                {QUALITY_LAYERS.map((layer, at) => {
                  const height = share(bar[layer], top) * (plot - TOP_GAP);
                  return (
                    <rect
                      key={layer}
                      x={barX(slot, at)}
                      y={plot - height}
                      width={BAR}
                      height={height}
                      rx={2}
                      className={`${LAYER_COLOUR[layer].fill} pointer-events-none`}
                    />
                  );
                })}
                <text
                  x={slot + SLOT / 2}
                  y={HEIGHT - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {formatShortMonth(bar.month, language)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ul
        aria-hidden="true"
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      >
        {QUALITY_LAYERS.map((layer) => (
          <li key={layer} className="flex items-center gap-1.5">
            <span className={`inline-block size-2.5 rounded-sm ${LAYER_COLOUR[layer].swatch}`} />
            {name(layer)}
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{t('panel.quality.months.month')}</th>
            {QUALITY_LAYERS.map((layer) => (
              <th key={layer} scope="col">
                {name(layer)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.month}>
              <th scope="row">{formatLongMonth(bar.month, language)}</th>
              {QUALITY_LAYERS.map((layer) => (
                <td key={layer}>{bar[layer]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
