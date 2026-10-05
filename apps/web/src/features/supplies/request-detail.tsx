'use client';

import { Download } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import type { CellValue } from '@/lib/csv';
import { downloadCsv, downloadXlsx } from '@/lib/export-table';
import { formatDateTime, formatDay, todayIso } from '@/lib/format-date';
import { serverErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import {
  canReject,
  nextStatuses,
  sortedItems,
  type SupplyRequest,
  type SupplyStatus,
  supplyPlace,
} from './schema';
import { useReviewSupplyRequest } from './use-supplies';

/** The button that moves a request into a status. */
const ACTION_KEY: Partial<Record<SupplyStatus, string>> = {
  accepted: 'accept',
  ordered: 'order',
  fulfilled: 'fulfill',
};

const TITLE_ID = 'supply-request-title';

interface RequestDetailProps {
  request: SupplyRequest;
  /**
   * Asked once, when the heading appears: true hands it the focus — the
   * list's way to keep the keyboard's place when the request takes the
   * list's place on a narrow screen.
   */
  claimHeadingFocus?: () => boolean;
}

/**
 * The request open beside the list (5.4, variant B): where and who, the
 * lines, the note, the manager's moves and the two files — one request
 * settled without scrolling past another. Its heading is the page's second
 * level: the page's one h1 is «Заявки на расходники».
 */
export function RequestDetail({ request, claimHeadingFocus }: RequestDetailProps) {
  const { t } = useTranslation();
  const focusHeading = useCallback(
    (heading: HTMLHeadingElement | null) => {
      if (heading !== null && claimHeadingFocus?.() === true) {
        heading.focus();
      }
    },
    [claimHeadingFocus],
  );

  return (
    <section
      aria-labelledby={TITLE_ID}
      className="flex flex-col gap-5 rounded-lg border bg-card p-4"
    >
      <RequestHead request={request} focusHeading={focusHeading} />
      <RequestLines request={request} />
      {request.note === null ? null : (
        <div className="flex flex-col gap-1">
          <h3 className="font-medium">{t('supplies.noteLabel')}</h3>
          <p className="text-sm whitespace-pre-wrap">{request.note}</p>
        </div>
      )}
      {request.status === 'rejected' ? (
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          {request.reject_reason === null ? null : (
            <p>
              {t('supplies.rejectReason')}: {request.reject_reason}
            </p>
          )}
          <p className="text-xs">{t('panel.supplies.rejectedHint')}</p>
        </div>
      ) : null}
      <RequestMoves request={request} />
      <RequestFiles request={request} />
    </section>
  );
}

interface RequestPartProps {
  request: SupplyRequest;
}

/** The place as the heading, the status and the urgency beside it, who and when under it. */
function RequestHead({
  request,
  focusHeading,
}: RequestPartProps & { focusHeading: (heading: HTMLHeadingElement | null) => void }) {
  const { t } = useTranslation();
  const language = useLanguage();

  return (
    <header className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2
          ref={focusHeading}
          id={TITLE_ID}
          tabIndex={-1}
          className="text-xl font-semibold break-words outline-none"
        >
          {supplyPlace(request) ?? t('supplies.general')}
        </h2>
        <StatusBadge status={`supplies.${request.status}`}>
          {t(`supplies.statuses.${request.status}`)}
        </StatusBadge>
        {request.priority === 'urgent' ? (
          <StatusBadge status="supplies.priority.urgent">
            {t('supplies.priorities.urgent')}
          </StatusBadge>
        ) : null}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {t('panel.supplies.requesterLabel')}
          <Person
            name={request.requester?.full_name}
            role={request.requester?.role}
            fallback={t('panel.supplies.unknownPerson')}
          />
        </span>
        <span>
          {t('panel.supplies.createdAt', { date: formatDateTime(request.created_at, language) })}
        </span>
        {request.needed_by === null ? null : (
          <span>
            {t('panel.supplies.neededBy', { date: formatDay(request.needed_by, language) })}
          </span>
        )}
        {request.fulfilled_at !== null ? (
          <span>
            {t('panel.supplies.fulfilledAt', {
              date: formatDateTime(request.fulfilled_at, language),
            })}
          </span>
        ) : request.reviewed_at !== null ? (
          <span>
            {t('panel.supplies.reviewedAt', {
              date: formatDateTime(request.reviewed_at, language),
            })}
          </span>
        ) : null}
      </p>
    </header>
  );
}

/** The lines in the order the cleaner entered them. */
function RequestLines({ request }: RequestPartProps) {
  const { t } = useTranslation();
  const items = sortedItems(request);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">{t('panel.supplies.items', { count: items.length })}</h3>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('panel.supplies.itemColumns.name')}</TableHead>
              <TableHead className="text-right">
                {t('panel.supplies.itemColumns.quantity')}
              </TableHead>
              <TableHead>{t('panel.supplies.itemColumns.comment')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-normal">{item.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.quantity} {t(`supplies.units.${item.unit}`)}
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {item.comment ?? ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** The manager's moves; a rejection asks for its reason in place. */
function RequestMoves({ request }: RequestPartProps) {
  const { t } = useTranslation();
  const review = useReviewSupplyRequest();
  const [isRejecting, setIsRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const forward = nextStatuses(request.status);
  const failure = review.isError ? serverErrorText(review.error) : null;
  const move = (status: SupplyStatus) => review.mutate({ requestId: request.id, status });
  const reject = () =>
    review.mutate(
      { requestId: request.id, status: 'rejected', rejectReason: reason },
      { onSuccess: () => setIsRejecting(false) },
    );

  return (
    <>
      {isRejecting ? (
        <RejectForm
          id={`reject-${request.id}`}
          reason={reason}
          isBusy={review.isPending}
          onReasonChange={setReason}
          onConfirm={reject}
          onAbort={() => setIsRejecting(false)}
        />
      ) : forward.length > 0 || canReject(request.status) ? (
        <div className="flex flex-wrap gap-2">
          {forward.map((status) => (
            <Button
              key={status}
              type="button"
              className="h-11"
              disabled={review.isPending}
              onClick={() => move(status)}
            >
              {t(`panel.supplies.actions.${ACTION_KEY[status] ?? status}`)}
            </Button>
          ))}
          {canReject(request.status) ? (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setIsRejecting(true)}
            >
              {t('panel.supplies.actions.reject')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {failure === null ? null : (
        <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
          <p>{failure.text}</p>
          {failure.detail === null ? null : (
            <p className="text-xs text-muted-foreground">{failure.detail}</p>
          )}
        </div>
      )}
    </>
  );
}

interface RejectFormProps {
  id: string;
  reason: string;
  isBusy: boolean;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onAbort: () => void;
}

/** A refusal waits for its reason: the cleaner reads it in the app. */
function RejectForm({ id, reason, isBusy, onReasonChange, onConfirm, onAbort }: RejectFormProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t('panel.supplies.actions.rejectReason')}</Label>
      <Textarea
        id={id}
        value={reason}
        onChange={(event) => onReasonChange(event.target.value)}
        rows={2}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          className="h-11"
          disabled={isBusy || reason.trim() === ''}
          onClick={onConfirm}
        >
          {t('panel.supplies.actions.rejectConfirm')}
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={onAbort}>
          {t('panel.supplies.actions.rejectAbort')}
        </Button>
      </div>
    </div>
  );
}

/** The file a supplier or a warehouse takes: who asked, for where, and the lines. */
function RequestFiles({ request }: RequestPartProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const requester = request.requester?.full_name ?? t('panel.supplies.unknownPerson');

  const rows: CellValue[][] = [
    [t('panel.supplies.export.property'), supplyPlace(request) ?? t('supplies.general')],
    [t('panel.supplies.export.requester'), requester],
    [t('panel.supplies.export.status'), t(`supplies.statuses.${request.status}`)],
    [t('panel.supplies.export.createdAt'), formatDateTime(request.created_at, language)],
    [t('panel.supplies.export.note'), request.note ?? ''],
    [],
    [
      t('panel.supplies.export.columns.name'),
      t('panel.supplies.export.columns.quantity'),
      t('panel.supplies.export.columns.unit'),
      t('panel.supplies.export.columns.comment'),
    ],
    ...sortedItems(request).map((item) => [
      item.name,
      item.quantity,
      t(`supplies.units.${item.unit}`),
      item.comment ?? '',
    ]),
  ];
  const name = `request-${todayIso()}-${request.id.slice(0, 8)}`;

  return (
    <div className="flex flex-wrap gap-2 border-t pt-4">
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={() => downloadCsv(`${name}.csv`, rows)}
      >
        <Download aria-hidden="true" />
        {t('panel.supplies.export.csv')}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={() => downloadXlsx(`${name}.xlsx`, t('panel.supplies.export.sheet'), rows)}
      >
        <Download aria-hidden="true" />
        {t('panel.supplies.export.xlsx')}
      </Button>
    </div>
  );
}
