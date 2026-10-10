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

/**
 * A page of `total` items, and a press that shows the next. The press takes
 * the focus to the first item it brought — the first link in it, found by
 * `itemSelector` under `listRef` — so a reader lands on what appeared rather
 * than on a button that may be gone.
 */
export function useShowMore(
  total: number,
  page: PageSize,
  listRef: RefObject<HTMLElement | null>,
  itemSelector: string,
): ShowMore {
  const [limit, setLimit] = useState(page.first);
  const shown = Math.min(limit, total);
  const more = Math.min(page.step, total - shown);

  const showMore = () => {
    const firstNew = shown;
    flushSync(() => setLimit(firstNew + page.step));
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
