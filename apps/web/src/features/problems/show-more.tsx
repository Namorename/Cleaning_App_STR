'use client';

import { useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

/**
 * How much of a long list shows (owner, 10.10: «Выполнено» must not grow the
 * page without end, and old tasks must stay within reach): the first page,
 * then a page more with each «Показать ещё».
 */
export interface PageSize {
  first: number;
  step: number;
}

/** The board's «Выполнено» — the one column that only grows. */
export const RESOLVED_PAGE: PageSize = { first: 10, step: 20 };
/** The list: dense rows, so a longer page. */
export const LIST_PAGE: PageSize = { first: 50, step: 50 };
/** The archive: a card a row, with its own button. */
export const ARCHIVE_PAGE: PageSize = { first: 20, step: 20 };
/** Everything at once. */
export const WHOLE: PageSize = { first: Number.POSITIVE_INFINITY, step: 0 };

export interface ShowMore {
  /** How many of the items show. */
  shown: number;
  /** How many the next press adds; 0 when all show. */
  more: number;
  showMore: () => void;
}

export interface ShowMoreOptions {
  /** How many items there are. */
  total: number;
  page: PageSize;
  /** The element the items are found under. */
  listRef: RefObject<HTMLElement | null>;
  /** Finds the items under `listRef`, in their order. */
  itemSelector: string;
  /**
   * What the items were chosen by (`filtersKey`): a new one starts the list on
   * its first page again, so opening it wide and then filtering and clearing
   * does not bring the long page back unasked.
   */
  resetKey: string;
}

/**
 * A page of `total` items, and a press that shows the next. The press takes
 * the focus to the first item it brought — the first link in it — so a reader
 * lands on what appeared rather than on a button that may be gone.
 */
export function useShowMore({
  total,
  page,
  listRef,
  itemSelector,
  resetKey,
}: ShowMoreOptions): ShowMore {
  const [paged, setPaged] = useState({ key: resetKey, limit: page.first });
  // Set while rendering, as React keeps a value from the render before: the
  // new filters show their first page in this very render.
  const isStale = paged.key !== resetKey;
  if (isStale) {
    setPaged({ key: resetKey, limit: page.first });
  }
  const limit = isStale ? page.first : paged.limit;
  const shown = Math.min(limit, total);
  const more = Math.min(page.step, total - shown);

  const showMore = () => {
    const firstNew = shown;
    flushSync(() => setPaged({ key: resetKey, limit: firstNew + page.step }));
    listRef.current
      ?.querySelectorAll<HTMLElement>(itemSelector)
      [firstNew]?.querySelector<HTMLElement>('a[href]')
      ?.focus();
  };

  return { shown, more, showMore };
}

interface ShowMoreButtonProps {
  more: number;
  total: number;
  onPress: () => void;
}

/** «Показать ещё N (всего M)»: how many the press adds, and how many there are. 44 px high. */
export function ShowMoreButton({ more, total, onPress }: ShowMoreButtonProps) {
  const { t } = useTranslation();
  if (more <= 0) {
    return null;
  }
  return (
    <Button type="button" variant="outline" className="h-11 w-full" onClick={onPress}>
      {t('panel.problems.showMore', { more, total })}
    </Button>
  );
}
