'use client';

import {
  guestOriginLines,
  isGuestSource,
  needsPmsSearch,
  type GuestOrigin,
  type GuestOriginLine,
} from '@str-ops/shared';
import {
  CalendarDays,
  Globe,
  Hash,
  MessageSquareText,
  MessagesSquare,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DetailSection } from '@/components/detail-section';
import { TextFromPms } from '@/features/guest-signals/text-from-pms';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

import type { Problem } from './schema';
import { useGuestOrigin } from './use-guest-origin';

interface OriginLinesProps {
  origin: GuestOrigin;
  className?: string;
}

/** Each fact's mark: the eye finds the dates, the guest and the numbers by it, not by reading. */
const LINE_ICON: Record<GuestOriginLine['key'], LucideIcon> = {
  stay: CalendarDays,
  months: CalendarDays,
  guest: UserRound,
  channel: Globe,
  sent: MessageSquareText,
  booking: Hash,
  conversation: MessagesSquare,
};

/**
 * The stay, the guest, the channel and the rating, the day sent, the PMS's numbers — the lines the
 * phone says too (`guestOriginLines`), here and on the cards of «Гости», so a task and its card show
 * the same. Each with its mark, two to a row where there is room (owner, 2026-11-19: one long column
 * of grey lines blended); a line that says why something is gone is muted.
 */
export function OriginLines({ origin, className }: OriginLinesProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  return (
    <ul className={cn('grid gap-x-6 gap-y-1.5 sm:grid-cols-2', className)}>
      {guestOriginLines(origin, t, language).map((line) => {
        const Icon = LINE_ICON[line.key];
        return (
          <li
            key={line.key}
            data-line={line.key}
            className={cn(
              'flex min-w-0 items-start gap-2',
              line.muted ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-words">{line.text}</span>
          </li>
        );
      })}
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
    <DetailSection title={t('problems.origin.title')}>
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
    </DetailSection>
  );
}
