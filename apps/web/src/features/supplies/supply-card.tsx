'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { formatDateTime, formatDay } from '@/lib/format-date';
import { serverErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import { statusVariant } from './format';
import {
  canReject,
  nextStatuses,
  sortedItems,
  type SupplyRequest,
  type SupplyStatus,
} from './schema';
import { useReviewSupplyRequest } from './use-supplies';

/** The button that moves a request into a status. */
const ACTION_KEY: Partial<Record<SupplyStatus, string>> = {
  accepted: 'accept',
  ordered: 'order',
  fulfilled: 'fulfill',
};

interface SupplyCardProps {
  request: SupplyRequest;
}

/** One request with its lines and the manager's moves; a rejection asks for its reason inline. */
export function SupplyCard({ request }: SupplyCardProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const review = useReviewSupplyRequest();
  const [isRejecting, setIsRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const items = sortedItems(request);
  const forward = nextStatuses(request.status);
  const failure = review.isError ? serverErrorText(review.error) : null;
  const requester = request.requester?.full_name ?? t('panel.supplies.unknownPerson');

  const move = (status: SupplyStatus) => review.mutate({ requestId: request.id, status });
  const reject = () =>
    review.mutate(
      { requestId: request.id, status: 'rejected', rejectReason: reason },
      { onSuccess: () => setIsRejecting(false) },
    );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{request.property?.name ?? t('supplies.general')}</CardTitle>
          {request.priority === 'urgent' ? (
            <Badge variant="destructive">{t('supplies.priorities.urgent')}</Badge>
          ) : null}
          <Badge variant={statusVariant(request.status)}>
            {t(`supplies.statuses.${request.status}`)}
          </Badge>
        </div>
        <CardDescription className="flex flex-wrap gap-x-3">
          <span>{t('panel.supplies.requester', { name: requester })}</span>
          <span>
            {t('panel.supplies.createdAt', { date: formatDateTime(request.created_at, language) })}
          </span>
          {request.needed_by !== null ? (
            <span>
              {t('panel.supplies.neededBy', { date: formatDay(request.needed_by, language) })}
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {request.note !== null ? (
          <p className="whitespace-pre-wrap text-muted-foreground">{request.note}</p>
        ) : null}

        <details open={request.status === 'new'}>
          <summary className="cursor-pointer font-medium">
            {t('panel.supplies.items', { count: items.length })}
          </summary>
          <Table className="mt-2">
            <TableHeader>
              <TableRow>
                <TableHead>{t('panel.supplies.itemColumns.name')}</TableHead>
                <TableHead>{t('panel.supplies.itemColumns.quantity')}</TableHead>
                <TableHead>{t('panel.supplies.itemColumns.comment')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>
                    {item.quantity} {t(`supplies.units.${item.unit}`)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.comment ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </details>

        {request.status === 'rejected' && request.reject_reason !== null ? (
          <p className="text-muted-foreground">
            {t('supplies.rejectReason')}: {request.reject_reason}
          </p>
        ) : null}
        {request.fulfilled_at !== null ? (
          <p className="text-muted-foreground">
            {t('panel.supplies.fulfilledAt', {
              date: formatDateTime(request.fulfilled_at, language),
            })}
          </p>
        ) : request.reviewed_at !== null ? (
          <p className="text-muted-foreground">
            {t('panel.supplies.reviewedAt', {
              date: formatDateTime(request.reviewed_at, language),
            })}
          </p>
        ) : null}

        {isRejecting ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`reject-${request.id}`}>
              {t('panel.supplies.actions.rejectReason')}
            </Label>
            <Textarea
              id={`reject-${request.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                disabled={review.isPending || reason.trim() === ''}
                onClick={reject}
              >
                {t('panel.supplies.actions.rejectConfirm')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setIsRejecting(false)}>
                {t('panel.supplies.actions.rejectAbort')}
              </Button>
            </div>
          </div>
        ) : forward.length > 0 || canReject(request.status) ? (
          <div className="flex flex-wrap gap-2">
            {forward.map((status) => (
              <Button
                key={status}
                type="button"
                disabled={review.isPending}
                onClick={() => move(status)}
              >
                {t(`panel.supplies.actions.${ACTION_KEY[status] ?? status}`)}
              </Button>
            ))}
            {canReject(request.status) ? (
              <Button type="button" variant="outline" onClick={() => setIsRejecting(true)}>
                {t('panel.supplies.actions.reject')}
              </Button>
            ) : null}
          </div>
        ) : null}

        {failure !== null ? (
          <p role="alert" className="text-destructive">
            {failure.text}
            {failure.detail !== null ? (
              <span className="block text-xs text-muted-foreground">{failure.detail}</span>
            ) : null}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
