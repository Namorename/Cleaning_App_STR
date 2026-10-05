'use client';

import { useTranslation } from 'react-i18next';

import { InPlaceLink } from '@/components/in-place-link';
import { StatusBadge } from '@/components/status-badge';
import { formatDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import { requestDay, sortedItems, supplyPlace, type SupplyRequest } from './schema';

interface RequestRowProps {
  request: SupplyRequest;
  href: string;
  /** Its request is the one open beside the list. */
  isCurrent: boolean;
  onOpen: () => void;
}

/**
 * One request in the list (5.4, variant B): a link the height of a panel row
 * or more (`TOUCH_TARGET.panelRow`, 52 px). Where, and the day it came; its
 * status and urgency in their tones, and who asked; what it asks for, in one
 * line. The open one is marked twice — a stripe down its left edge and the
 * muted fill — so the mark is not a colour alone.
 */
export function RequestRow({ request, href, isCurrent, onOpen }: RequestRowProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const items = sortedItems(request);
  const [first] = items;
  const asked =
    first === undefined
      ? ''
      : items.length === 1
        ? first.name
        : t('supplies.moreItems', { shown: first.name, count: items.length - 1 });

  return (
    <InPlaceLink
      href={href}
      onOpen={onOpen}
      isCurrent={isCurrent}
      data-request-link={request.id}
      className="flex min-h-13 flex-col gap-1 border-l-[3px] border-transparent px-3 py-2 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset aria-[current=true]:border-primary aria-[current=true]:bg-muted"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 font-medium break-words">
          {supplyPlace(request) ?? t('supplies.general')}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatDay(requestDay(request), language)}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge status={`supplies.${request.status}`}>
          {t(`supplies.statuses.${request.status}`)}
        </StatusBadge>
        {request.priority === 'urgent' ? (
          <StatusBadge status="supplies.priority.urgent">
            {t('supplies.priorities.urgent')}
          </StatusBadge>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {request.requester?.full_name ?? t('panel.supplies.unknownPerson')}
        </span>
      </span>
      {asked === '' ? null : (
        <span className="truncate text-xs text-muted-foreground">{asked}</span>
      )}
    </InPlaceLink>
  );
}
