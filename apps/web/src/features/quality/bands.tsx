'use client';

import { useTranslation } from 'react-i18next';

import { formatDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import type { QualityMeta } from './schema';
import type { ReadingState, StaysCoverage } from './theme-model';

function Band({ children }: { children: string }) {
  return (
    <p role="status" className="rounded-xl bg-muted/50 p-3 text-sm">
      {children}
    </p>
  );
}

/** Where the reading of past reviews stands, and that trends wait for it (§6.4). */
export function ReadingBand({ reading }: { reading: ReadingState }) {
  const { t } = useTranslation();

  if (reading.kind === 'done') {
    return null;
  }
  if (reading.kind === 'unread') {
    return <Band>{t('panel.quality.history.unread')}</Band>;
  }
  return (
    <Band>
      {reading.total === null
        ? t('panel.quality.history.readingOpen', { done: reading.done })
        : t('panel.quality.history.reading', { done: reading.done, count: reading.total })}
    </Band>
  );
}

interface StaysBandProps {
  coverage: StaysCoverage;
  /** The first month read; null when none was. */
  loadedFrom: string | null;
}

/** Stays not read are not zero stays: the screen says which it is (§6.4). */
export function StaysBand({ coverage, loadedFrom }: StaysBandProps) {
  const { t } = useTranslation();
  const language = useLanguage();

  if (coverage === 'whole') {
    return null;
  }
  return (
    <Band>
      {coverage === 'partial' && loadedFrom !== null
        ? t('panel.quality.stays.partly', { from: formatDay(loadedFrom, language) })
        : t('panel.quality.stays.notLoaded')}
    </Band>
  );
}

/** A review keeps its day only until it settles, so the short windows cannot count every one. */
export function ShortWindowBand({ grain }: { grain: QualityMeta['grain'] }) {
  const { t } = useTranslation();

  return grain === 'week' ? <Band>{t('panel.quality.history.shortWindow')}</Band> : null;
}
