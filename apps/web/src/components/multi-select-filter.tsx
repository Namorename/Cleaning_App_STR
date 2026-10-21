'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { matchesAllTokens } from '@/lib/search';

export interface MultiSelectOption {
  id: string;
  label: string;
}

/** A list this long or shorter is read at a glance: no search, no bulk buttons. */
export const SHORT_LIST_MAX = 8;

/** Whether a list of this many values gets the search and the two buttons. */
export function isLongList(count: number): boolean {
  return count > SHORT_LIST_MAX;
}

/** The open list's width, and the margin it keeps from the window's edges. */
const PANEL_WIDTH_PX = 288;
const EDGE_GUTTER_PX = 16;

/** A mouse or a trackpad: the search takes the focus at once. A finger would get a keyboard over the list. */
const FINE_POINTER = '(pointer: fine)';

function isFinePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(FINE_POINTER).matches;
}

/**
 * Where the open list goes: under its button, as wide as it fits, and moved
 * left when the button sits so far right that the list would leave the window
 * (a phone ~470 px wide, a button that wrapped to the end of its row).
 */
function placementFor(button: DOMRect, windowWidth: number): CSSProperties {
  const width = Math.min(PANEL_WIDTH_PX, windowWidth - 2 * EDGE_GUTTER_PX);
  const overflow = button.left + width - (windowWidth - EDGE_GUTTER_PX);
  return { width, left: overflow > 0 ? -overflow : 0 };
}

interface MultiSelectFilterProps {
  label: string;
  options: readonly MultiSelectOption[];
  /** The ids ticked; it may hold ids the options no longer offer, and they stay. */
  selected: readonly string[];
  onChange: (next: string[]) => void;
  /**
   * Nothing ticked and everything ticked both narrow nothing: the button of a
   * long list ticked whole then shows no count, and the counter of an empty
   * choice says that all count.
   */
  wholeMeansAll?: boolean;
  /**
   * A fixed set of values the manager knows by heart — the statuses: read at
   * a glance however many, so it never gets a search (owner, 2026-10-21).
   */
  isFixedSet?: boolean;
}

/**
 * One filter of a page: a button that opens a checkbox per value.
 *
 * A long list (more than `SHORT_LIST_MAX`, and not a fixed set) gets a
 * search over it and two buttons. The search finds every word typed, in any order, case and
 * diacritics aside (`matchesAllTokens`); it hides rows and never unticks one.
 * «Select all» and «Deselect all» act on the rows in sight only, so a value
 * ticked and then searched out of sight stays as it was — with nothing typed,
 * they act on the whole list. The search and the buttons stay above the rows
 * while the rows scroll.
 *
 * It closes on Escape (the focus goes back to its button), on a press
 * anywhere outside it, and when the focus moves on to something else; the
 * search is cleared every time it closes.
 */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  wholeMeansAll = false,
  isFixedSet = false,
}: MultiSelectFilterProps) {
  const { t } = useTranslation();
  const id = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const root = useRef<HTMLDetailsElement>(null);
  const button = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const isLong = !isFixedSet && isLongList(options.length);
  const chosen = new Set(selected);
  const shown = isLong ? options.filter((option) => matchesAllTokens(option.label, query)) : options;
  const toTick = shown.filter((option) => !chosen.has(option.id)).map((option) => option.id);
  const toUntick = new Set(shown.filter((option) => chosen.has(option.id)).map((option) => option.id));
  const tickedCount = options.filter((option) => chosen.has(option.id)).length;
  const isWhole = options.length > 0 && tickedCount === options.length;
  const badge = wholeMeansAll && isLong && isWhole ? 0 : selected.length;

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const closeOutside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && isLong && isFinePointer()) {
      search.current?.focus();
    }
  }, [isOpen, isLong]);

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      close();
      button.current?.focus();
    }
  };
  // The keyboard's way out: the focus moving on to something else. A focus
  // that just leaves (Safari ticks a checkbox without focusing it) is not one.
  const closeOnFocusAway = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (isOpen && next !== null && !root.current?.contains(next)) {
      close();
    }
  };
  const toggle = (value: string) =>
    onChange(chosen.has(value) ? selected.filter((one) => one !== value) : [...selected, value]);

  const counter =
    wholeMeansAll && tickedCount === 0
      ? t('panel.listFilter.noneSelectedAll', { total: options.length })
      : t('panel.listFilter.selected', { chosen: tickedCount, total: options.length });

  return (
    <details
      ref={root}
      open={isOpen}
      onKeyDown={closeOnEscape}
      onBlur={closeOnFocusAway}
      className="group relative"
    >
      <summary
        ref={button}
        // The page holds the state: the browser's own toggle would undo it.
        onClick={(event) => {
          event.preventDefault();
          if (isOpen) {
            close();
            return;
          }
          setPlacement(placementFor(event.currentTarget.getBoundingClientRect(), window.innerWidth));
          setIsOpen(true);
        }}
        className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-3 text-sm ring-1 ring-foreground/15 hover:bg-muted/60"
      >
        {label}
        {badge === 0 ? null : (
          <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{badge}</span>
        )}
      </summary>
      <div
        style={placement ?? undefined}
        className="absolute left-0 z-20 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg bg-popover shadow-md ring-1 ring-foreground/10"
      >
        {isLong ? (
          <div className="flex flex-col gap-2 border-b border-foreground/10 p-2">
            <Input
              ref={search}
              type="search"
              className="h-11"
              value={query}
              placeholder={t('panel.listFilter.search')}
              aria-label={t('panel.listFilter.searchIn', { name: label })}
              onChange={(event) => setQuery(event.target.value)}
              // Enter after a word must never submit a form the filter sits in.
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                }
              }}
            />
            {/* Off, but still focusable: a button that disables itself under
                the keyboard would drop the focus out of the list. */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 flex-1"
                disabled={toTick.length === 0}
                focusableWhenDisabled
                onClick={() => onChange([...selected, ...toTick])}
              >
                {t('panel.listFilter.selectAll')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 flex-1"
                disabled={toUntick.size === 0}
                focusableWhenDisabled
                onClick={() => onChange(selected.filter((one) => !toUntick.has(one)))}
              >
                {t('panel.listFilter.clearAll')}
              </Button>
            </div>
            <p role="status" className="text-xs text-muted-foreground">
              {counter}
            </p>
          </div>
        ) : null}
        <fieldset className="flex max-h-72 min-h-0 flex-col gap-1 overflow-y-auto p-2">
          <legend className="sr-only">{label}</legend>
          {shown.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">{t('panel.listFilter.noMatch')}</p>
          ) : (
            shown.map((option) => (
              <label
                key={option.id}
                htmlFor={`${id}-${option.id}`}
                className="flex min-h-11 items-center gap-2 rounded px-2 text-sm hover:bg-muted/60"
              >
                <input
                  id={`${id}-${option.id}`}
                  type="checkbox"
                  className="size-4 shrink-0"
                  checked={chosen.has(option.id)}
                  onChange={() => toggle(option.id)}
                />
                <span className="truncate">{option.label}</span>
              </label>
            ))
          )}
        </fieldset>
      </div>
    </details>
  );
}
