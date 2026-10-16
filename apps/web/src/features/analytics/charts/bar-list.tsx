'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { niceMax, share } from './geometry';

export interface BarItem {
  id: string;
  label: string;
  value: number;
  /** The value as the page writes it. */
  valueText: string;
}

interface BarListProps {
  title: string;
  items: readonly BarItem[];
  /** The ids the page is filtered to: their bars stay pressed. */
  selected: readonly string[];
  onToggle: (id: string) => void;
  emptyText: string;
  /** While the bars load, or why they did not: said in place of the bars. */
  status?: { loading: string } | { error: ReactNode };
}

/**
 * Horizontal bars, one button each: a click filters the whole page to that
 * bar (and a second click lets it go). The figure is written beside the bar,
 * so the length is never the only way to read it.
 */
export function BarList({ title, items, selected, onToggle, emptyText, status }: BarListProps) {
  const top = niceMax(Math.max(0, ...items.map((item) => item.value)));
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <h2 className="text-sm font-medium">{title}</h2>
      {status !== undefined ? (
        'loading' in status ? (
          <p role="status" className="text-sm text-muted-foreground">
            {status.loading}
          </p>
        ) : (
          status.error
        )
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const isSelected = selected.includes(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onToggle(item.id)}
                  className={cn(
                    'flex min-h-11 w-full min-w-0 flex-col gap-1 rounded-lg px-2 py-1 text-left text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring',
                    isSelected && 'bg-muted ring-1 ring-primary',
                    // Something is picked: the rest stay, quieter, one click from joining.
                    selected.length > 0 && !isSelected && 'opacity-60',
                  )}
                >
                  <span className="flex min-w-0 justify-between gap-2">
                    <span className="truncate">{item.label}</span>
                    <span className="tabular-nums text-muted-foreground">{item.valueText}</span>
                  </span>
                  <span aria-hidden="true" className="h-2 w-full rounded-full bg-muted">
                    <span
                      className="block h-2 rounded-full bg-[var(--chart-1)]"
                      style={{ width: `${share(item.value, top) * 100}%` }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
