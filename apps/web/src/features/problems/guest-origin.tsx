'use client';

import {
  guestOriginLines,
  isGuestSource,
  needsPmsSearch,
  type GuestOrigin,
} from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { TextFromPms } from '@/features/guest-signals/text-from-pms';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

import type { Problem } from './schema';
import { useGuestOrigin } from './use-guest-origin';

interface OriginLinesProps {
  origin: GuestOrigin;
  className?: string;
}

/**
 * The stay, the guest, the channel and the rating, the day sent, the PMS's numbers — the lines the
 * phone says too (`guestOriginLines`), here and on the cards of «Гости», so a task and its card show
 * the same. A line that says why something is gone is muted.
 */
export function OriginLines({ origin, className }: OriginLinesProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  return (
    <ul className={cn('flex flex-col gap-0.5', className)}>
      {guestOriginLines(origin, t, language).map((line) => (
        <li
          key={line.key}
          data-line={line.key}
          className={line.muted ? 'text-muted-foreground' : undefined}
        >
          {line.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * «Гость и проживание» on a task from a guest's review or chat (owner, 2026-11-11). The name is read
 * from the booking when the page opens and kept nowhere; once retention or the decision has taken
 * it, the block says so. No link to the conversation: the address of Hostaway's inbox is not
 * confirmed, so the office gets the numbers to search by. A review's words come, as on «Гости», by
 * «Показать текст из Hostaway».
 */
export function GuestOriginBlock({ problem }: { problem: Pick<Problem, 'id' | 'source'> }) {
  const { t } = useTranslation();
  const isFromGuest = isGuestSource(problem.source);
  const origin = useGuestOrigin(problem.id, isFromGuest);

  if (!isFromGuest || origin.isPending || origin.data === null) {
    return null;
  }
  return (
    <section aria-label={t('problems.origin.title')} className="flex flex-col gap-1">
      <h2 className="font-medium">{t('problems.origin.title')}</h2>
      {origin.isError ? (
        <p className="text-muted-foreground">{t('problems.origin.loadFailed')}</p>
      ) : (
        <>
          <OriginLines origin={origin.data} />
          {needsPmsSearch(origin.data) ? (
            <p className="text-xs text-muted-foreground">{t('problems.origin.findInPms')}</p>
          ) : null}
          {origin.data.source === 'review' &&
          origin.data.has_text === true &&
          typeof origin.data.signal_id === 'string' ? (
            <TextFromPms signalId={origin.data.signal_id} />
          ) : null}
        </>
      )}
    </section>
  );
}
