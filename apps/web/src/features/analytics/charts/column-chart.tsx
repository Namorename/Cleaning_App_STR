'use client';

import type { KeyboardEvent } from 'react';

import { niceMax, share, ticks } from './geometry';

export interface ColumnSeries {
  name: string;
  /** A Tailwind fill class from the chart tokens, e.g. `fill-[var(--chart-1)]`. */
  fillClass: string;
  swatchClass: string;
}

export interface ColumnPoint {
  key: string;
  /** Under the column, short. */
  label: string;
  /** One value per series, in the series' order. */
  values: readonly number[];
  /** The column in words, for the screen reader and the tooltip. */
  description: string;
}

interface ColumnChartProps {
  title: string;
  series: readonly ColumnSeries[];
  points: readonly ColumnPoint[];
  /** A column picked: the page narrows its period to it. */
  onSelect: (key: string) => void;
}

const HEIGHT = 200;
const AXIS = 32;
const BOTTOM = 22;
/** At least 24 px: the smallest target WCAG 2.5.8 allows. */
const SLOT = 24;

/**
 * Columns by day or by week, the series side by side in each slot. Every
 * slot is a button: a click or Enter narrows the page to that day or week.
 */
export function ColumnChart({ title, series, points, onSelect }: ColumnChartProps) {
  const top = niceMax(Math.max(0, ...points.flatMap((point) => point.values)));
  const width = AXIS + Math.max(points.length, 1) * SLOT;
  const plot = HEIGHT - BOTTOM;
  const bar = Math.max(2, (SLOT - 6) / Math.max(series.length, 1));
  // A label under every n-th column, so they do not run into each other: a
  // short date is wider than one slot.
  const every = points.length <= 3 ? 1 : Math.max(2, Math.ceil(points.length / 10));

  const pick = (event: KeyboardEvent, key: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(key);
    }
  };

  return (
    <figure className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <div className="min-w-0 overflow-x-auto">
        <svg
          role="group"
          aria-label={title}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="xMinYMid meet"
          className="h-[200px] max-w-none"
          style={{ width }}
        >
          {ticks(top).map((tick) => {
            const y = plot - share(tick, top) * (plot - 8);
            return (
              <g key={tick} aria-hidden="true">
                <line x1={AXIS} x2={width} y1={y} y2={y} className="stroke-foreground/10" />
                <text x={AXIS - 4} y={y + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
                  {tick}
                </text>
              </g>
            );
          })}
          {points.map((point, index) => {
            const x = AXIS + index * SLOT;
            return (
              <g
                key={point.key}
                role="button"
                tabIndex={0}
                aria-label={point.description}
                onClick={() => onSelect(point.key)}
                onKeyDown={(event) => pick(event, point.key)}
                className="group/slot cursor-pointer outline-none"
              >
                {/* The focus is drawn: a ring around the slot, not a tint. */}
                <rect
                  className="fill-transparent stroke-transparent stroke-2 group-hover/slot:fill-muted/60 group-focus-visible/slot:stroke-ring"
                  x={x + 1}
                  y={1}
                  width={SLOT - 2}
                  height={plot - 2}
                  rx={3}
                />
                {point.values.map((value, at) => {
                  const h = share(value, top) * (plot - 8);
                  return (
                    <rect
                      key={series[at]?.name ?? at}
                      x={x + 3 + at * bar}
                      y={plot - h}
                      width={bar - 1}
                      height={h}
                      rx={1.5}
                      // An edge for a light colour on a light card.
                      className={`${series[at]?.fillClass ?? ''} stroke-foreground/40 stroke-[0.5]`}
                    />
                  );
                })}
                {index % every === 0 ? (
                  <text
                    aria-hidden="true"
                    x={x + SLOT / 2}
                    y={HEIGHT - 6}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[10px]"
                  >
                    {point.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((one) => (
          <li key={one.name} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`inline-block size-2.5 rounded-sm ${one.swatchClass}`} />
            {one.name}
          </li>
        ))}
      </ul>
    </figure>
  );
}
