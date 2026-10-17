'use client';

import { propertyPathOf } from '@str-ops/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useStaff } from '@/features/problems/use-problems';
import { formatDateTime, formatDay, todayIso } from '@/lib/format-date';
import type { Language } from '@str-ops/shared';

import {
  findingWords,
  isModelReading,
  isTaskKind,
  monthOf,
  REJECT_REASONS,
  type Finding,
  type PlaceProblem,
  type RejectReason,
} from './schema';
import { useApproveFinding, usePlaceProblems, useRejectFinding } from './use-reviews';

interface FindingCardProps {
  finding: Finding;
  language: Language;
}

/** What the manager decides on: the finding, the review it came from, the place, and the levers (§4.6–4.7). */
export function FindingCard({ finding, language }: FindingCardProps) {
  const { t } = useTranslation();
  const review = finding.review;
  const words = findingWords(finding, language);
  const what = `${t(`reviews.kind.${finding.kind}`)} · ${t(`reviews.subject.${finding.subject}`)}`;
  const isOpenToDecide = ['candidate', 'dropped', 'already_fixed'].includes(finding.status);

  return (
    <article
      aria-label={what}
      className="flex flex-col gap-3 rounded-lg border p-4"
      data-urgency={finding.urgency}
    >
      <header className="flex flex-wrap items-center gap-2">
        {finding.urgency === 'high' ? (
          <Badge variant="destructive">{t('panel.reviews.card.urgent')}</Badge>
        ) : null}
        <h3 className="font-medium">{what}</h3>
        <span className="text-sm text-muted-foreground">
          {propertyPathOf(finding.place) ?? t('panel.reviews.card.noPlace')}
        </span>
      </header>

      <p className="text-sm">
        {words === null ? (
          <span className="text-muted-foreground">{t('panel.reviews.card.noWords')}</span>
        ) : (
          <span>«{words}»</span>
        )}{' '}
        <span className="text-xs text-muted-foreground">
          {isModelReading(finding)
            ? t('panel.reviews.card.byModel')
            : t('panel.reviews.card.byRules')}
          {finding.confidence === null ? '' : ` · ${finding.confidence.toFixed(2)}`}
        </span>
      </p>

      {review === null ? null : <ReviewFacts finding={finding} language={language} />}
      {finding.evidence === null ? null : (
        <blockquote className="border-l-2 pl-3 text-sm italic">
          {finding.evidence}{' '}
          <span className="not-italic text-xs text-muted-foreground">
            {t(`panel.reviews.card.source.${finding.evidence_source ?? 'public'}`)}
          </span>
        </blockquote>
      )}
      {review === null ? null : <FullReview review={review} />}
      <PlaceProblems findingId={finding.id} language={language} />

      {isOpenToDecide && isTaskKind(finding.kind) ? (
        <Decide finding={finding} words={words} />
      ) : null}
    </article>
  );
}

function ReviewFacts({ finding, language }: FindingCardProps) {
  const { t } = useTranslation();
  const review = finding.review;
  if (review === null) {
    return null;
  }
  const categories = Object.entries(review.category_ratings)
    .map(([key, value]) => `${t(`panel.reviews.category.${key}`)} ${value}`)
    .join(', ');
  const stay = review.stay_exact
    ? [review.arrival_date, review.departure_date]
        .map((day) => (day === null ? '—' : formatDay(day, language)))
        .join(' – ')
    : t('panel.reviews.card.monthOnly', {
        month: monthOf(review.departure_date) ?? monthOf(review.submitted_at),
      });

  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
      <dd>{t(`panel.reviews.channel.${review.channel}`)}</dd>
      <dd>
        {review.rating === null ? t('panel.reviews.card.noRating') : `${review.rating}/10`}
        {categories === '' ? '' : ` (${categories})`}
      </dd>
      <dd>{stay}</dd>
      {review.stay_exact && review.external_reservation_id !== null ? (
        <dd>{t('panel.reviews.card.booking', { id: review.external_reservation_id })}</dd>
      ) : null}
    </dl>
  );
}

function FullReview({ review }: { review: NonNullable<Finding['review']> }) {
  const { t } = useTranslation();
  const comments = Object.entries(review.category_comments ?? {});
  if (review.public_text === null && review.private_text === null && comments.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('panel.reviews.card.noText')}</p>;
  }
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">{t('panel.reviews.card.fullReview')}</summary>
      <div className="mt-2 flex flex-col gap-2">
        {review.public_text === null ? null : (
          <p className="whitespace-pre-line">{review.public_text}</p>
        )}
        {review.private_text === null ? null : (
          <p className="whitespace-pre-line">
            <span className="text-xs text-muted-foreground">
              {t('panel.reviews.card.privateOnly')}{' '}
            </span>
            {review.private_text}
          </p>
        )}
        {comments.map(([category, comment]) => (
          <p key={category}>
            <span className="text-xs text-muted-foreground">
              {t(`panel.reviews.category.${category}`)}:{' '}
            </span>
            {comment}
          </p>
        ))}
        {review.text_truncated ? (
          <p className="text-xs text-muted-foreground">{t('panel.reviews.card.truncated')}</p>
        ) : null}
      </div>
    </details>
  );
}

function PlaceProblems({ findingId, language }: { findingId: string; language: Language }) {
  const { t } = useTranslation();
  const query = usePlaceProblems(findingId);
  if (query.isError) {
    return <ErrorState error={query.error} />;
  }
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return null;
  }
  return (
    <section aria-label={t('panel.reviews.card.onPlace')} className="text-sm">
      <h4 className="text-xs font-semibold text-muted-foreground">
        {t('panel.reviews.card.onPlace')}
      </h4>
      <ul className="mt-1 flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.id}>
            {row.is_open ? '●' : '✓'} «{row.title_i18n?.[language] ?? row.title}»{' '}
            <span className="text-xs text-muted-foreground">
              {t(`problems.statuses.${row.status}`)} ·{' '}
              {formatDateTime(row.resolved_at ?? row.created_at, language)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function linkable(rows: readonly PlaceProblem[] | undefined, isOpen: boolean): PlaceProblem[] {
  return (rows ?? []).filter((row) => row.can_link && row.is_open === isOpen);
}

/** The manager's levers on one finding (§4.7): create (to «Открытые» or a technician), link, reject. */
function Decide({ finding, words }: { finding: Finding; words: string | null }) {
  const { t } = useTranslation();
  const staff = useStaff();
  const place = usePlaceProblems(finding.id);
  const approve = useApproveFinding();
  const reject = useRejectFinding();
  const [title, setTitle] = useState(
    words ?? `${t(`reviews.kind.${finding.kind}`)}: ${t(`reviews.subject.${finding.subject}`)}`,
  );
  const [priority, setPriority] = useState(finding.urgency);
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [linkId, setLinkId] = useState('');
  const [reason, setReason] = useState<RejectReason>('false_positive');
  const open = linkable(place.data, true);
  const fixed = linkable(place.data, false);

  const create = (event: FormEvent) => {
    event.preventDefault();
    approve.mutate({
      findingId: finding.id,
      // The model's own words go with their translations; any other title is the manager's.
      title: title.trim() === words ? undefined : title.trim(),
      priority,
      description: description.trim() === '' ? undefined : description.trim(),
      assigneeId: assigneeId === '' ? undefined : assigneeId,
      scheduledDate: date,
    });
  };

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <form onSubmit={create} className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Label className="flex flex-col items-start gap-1 md:col-span-2">
          {t('panel.reviews.decide.title')}
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
          />
        </Label>
        <Label className="flex flex-col items-start gap-1">
          {t('panel.reviews.decide.priority')}
          <NativeSelect
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
          >
            {(['low', 'normal', 'high'] as const).map((p) => (
              <option key={p} value={p}>
                {t(`problems.priorities.${p}`)}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="flex flex-col items-start gap-1">
          {t('panel.reviews.decide.assignee')}
          <NativeSelect value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">{t('panel.reviews.decide.toOpen')}</option>
            {(staff.data ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name ?? t('panel.problems.unknownPerson')}
              </option>
            ))}
          </NativeSelect>
        </Label>
        {assigneeId === '' ? null : (
          <Label className="flex flex-col items-start gap-1">
            {t('panel.reviews.decide.date')}
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Label>
        )}
        <Label className="flex flex-col items-start gap-1 md:col-span-2">
          {t('panel.reviews.decide.description')}
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4000}
          />
        </Label>
        <div className="md:col-span-2">
          <Button type="submit" disabled={approve.isPending}>
            {assigneeId === ''
              ? t('panel.reviews.decide.createOpen')
              : t('panel.reviews.decide.createAssigned')}
          </Button>
        </div>
      </form>

      {open.length + fixed.length === 0 ? null : (
        <div className="flex flex-wrap items-end gap-2">
          <Label className="flex flex-col items-start gap-1">
            {t('panel.reviews.decide.linkTo')}
            <NativeSelect value={linkId} onChange={(e) => setLinkId(e.target.value)}>
              <option value="">—</option>
              {[...open, ...fixed].map((row) => (
                <option key={row.id} value={row.id}>
                  {(row.is_open
                    ? t('panel.reviews.decide.same')
                    : t('panel.reviews.decide.fixed')) +
                    ': ' +
                    row.title}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Button
            variant="outline"
            disabled={linkId === '' || approve.isPending}
            onClick={() => approve.mutate({ findingId: finding.id, linkProblemId: linkId })}
          >
            {t('panel.reviews.decide.link')}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Label className="flex flex-col items-start gap-1">
          {t('panel.reviews.decide.rejectReason')}
          <NativeSelect value={reason} onChange={(e) => setReason(e.target.value as RejectReason)}>
            {REJECT_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`panel.reviews.reason.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Button
          variant="outline"
          disabled={reject.isPending}
          onClick={() => reject.mutate({ findingId: finding.id, reason })}
        >
          {t('panel.reviews.decide.reject')}
        </Button>
      </div>

      {approve.isError ? <ErrorState error={approve.error} /> : null}
      {reject.isError ? <ErrorState error={reject.error} /> : null}
    </div>
  );
}
