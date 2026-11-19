'use client';

import { MapPin } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { DetailSection } from '@/components/detail-section';
import { ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { GuestMessageBlock } from '@/features/problems/guest-message';
import { OriginLines } from '@/features/problems/guest-origin';
import { SourceBadge } from '@/features/problems/source-badge';
import { useStaff } from '@/features/problems/use-problems';
import { formatDateTime, todayIso } from '@/lib/format-date';
import { cn } from '@/lib/utils';
import { PROBLEM_LEVELS, storedUrgency, type Language, type ProblemLevel } from '@str-ops/shared';

import {
  findingAge,
  findingOrigin,
  findingWords,
  isFromMessage,
  isModelReading,
  isTaskKind,
  placePathOf,
  REJECT_REASONS,
  type Finding,
  type PlaceProblem,
  type RejectReason,
} from './schema';
import { useApproveFinding, usePlaceProblems, useRejectFinding } from './use-guest-signals';

interface FindingCardProps {
  finding: Finding;
  language: Language;
}

/**
 * What the manager decides on: the finding, the review or the chat it came from,
 * the place, and the levers (§4.6–4.7). A chat's card keeps no words of the guest
 * or the model: the kind, the subject, when in the stay, the conversation's
 * number (docs/guest-chats.md), and the guest's message itself read from Hostaway
 * on the manager's press, kept by nobody (docs/guest-message-text.md).
 */
export function FindingCard({ finding, language }: FindingCardProps) {
  const { t } = useTranslation();
  const review = finding.signal;
  const words = findingWords(finding, language);
  const what = `${t(`panel.guests.kind.${finding.kind}`)} · ${t(`panel.guests.subject.${finding.subject}`)}`;
  const isOpenToDecide = ['candidate', 'dropped', 'already_fixed'].includes(finding.status);
  const isChat = isFromMessage(finding);

  const canDecide = isOpenToDecide && isTaskKind(finding.kind);

  // Two sides where the width allows (owner, 2026-11-19: one long column where everything blended):
  // what the guest's signal says on the left, read top down; the decision on its own ground on the
  // right. Narrower, the decision follows under a line.
  return (
    <article
      aria-label={what}
      className="overflow-hidden rounded-xl border bg-card text-sm shadow-xs"
      data-urgency={finding.urgency}
    >
      <header className="flex flex-col gap-1.5 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {finding.urgency === 'high' ? (
            <Badge variant="destructive">{t('panel.guests.card.urgent')}</Badge>
          ) : null}
          <SourceBadge source={isChat ? 'message' : 'review'} />
          <span className="ml-auto">
            <FoundAge finding={finding} language={language} />
          </span>
        </div>
        <h3 className="text-base font-semibold">{what}</h3>
        <p className="flex items-start gap-1.5 text-muted-foreground">
          <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">
            {placePathOf(finding.place) ?? t('panel.guests.card.noPlace')}
          </span>
        </p>
      </header>

      <div className={cn('grid', canDecide && 'lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]')}>
        <div className="flex min-w-0 flex-col gap-5 p-4">
          <FindingWords finding={finding} words={words} />
          <SignalFacts finding={finding} />
          {isChat ? <GuestMessageBlock ask={{ findingId: finding.id }} headingLevel={4} /> : null}
          {finding.evidence === null ? null : (
            <blockquote className="border-l-2 border-primary/40 pl-3 italic">
              {finding.evidence}{' '}
              <span className="text-xs text-muted-foreground not-italic">
                {t(`panel.guests.card.source.${finding.evidence_source ?? 'public'}`)}
              </span>
            </blockquote>
          )}
          {review === null || isChat ? null : <FullReview review={review} />}
          <PlaceProblems findingId={finding.id} language={language} />
        </div>

        {canDecide ? (
          <div className="border-t bg-muted/40 p-4 lg:border-t-0 lg:border-l">
            <Decide finding={finding} words={words} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

/**
 * The finding in words — the model's own, or a word that it has none — and, quieter beside it, who
 * read it and how sure it was.
 */
function FindingWords({ finding, words }: { finding: Finding; words: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      {words === null ? (
        <p className="text-muted-foreground">{t('panel.guests.card.noWords')}</p>
      ) : (
        <p className="text-base leading-relaxed text-foreground">«{words}»</p>
      )}
      <p className="text-xs text-muted-foreground">
        {isModelReading(finding) ? t('panel.guests.card.byModel') : t('panel.guests.card.byRules')}
        {finding.confidence === null ? '' : ` · ${finding.confidence.toFixed(2)}`}
      </p>
    </div>
  );
}

/** How long a candidate has waited for a decision; nothing once its time is only a month. */
function FoundAge({ finding, language }: FindingCardProps) {
  const { t } = useTranslation();
  const days = findingAge(finding);
  if (days === null) {
    return null;
  }
  return (
    <time
      dateTime={finding.created_at}
      title={formatDateTime(finding.created_at, language)}
      className="text-sm text-muted-foreground"
    >
      {days === 0
        ? t('panel.guests.card.foundToday')
        : t('panel.guests.card.foundAgo', { count: days })}
    </time>
  );
}

/**
 * The card's facts as its task tells them (`OriginLines`, owner 2026-11-11): the stay — the days
 * while exact, the months after the cut — the guest's name read from the booking now, the channel
 * and the rating, the day sent, the numbers to search Hostaway by. Beside them what only a card has:
 * a review's ratings by category, the moment in the stay a chat was written.
 */
function SignalFacts({ finding }: { finding: Finding }) {
  const { t } = useTranslation();
  const origin = findingOrigin(finding);
  const signal = finding.signal;
  if (origin === null || signal === null) {
    return null;
  }
  const categories = Object.entries(signal.category_ratings)
    .map(([key, value]) => `${t(`panel.guests.category.${key}`)} ${value}`)
    .join(', ');
  return (
    <DetailSection title={t('problems.origin.title')} level={4}>
      <OriginLines origin={origin} />
      {categories === '' ? null : <p className="text-muted-foreground">{categories}</p>}
      {signal.stay_phase === null ? null : (
        <p className="text-muted-foreground">{t(`panel.guests.card.phase.${signal.stay_phase}`)}</p>
      )}
    </DetailSection>
  );
}

function FullReview({ review }: { review: NonNullable<Finding['signal']> }) {
  const { t } = useTranslation();
  const comments = Object.entries(review.category_comments ?? {});
  if (review.public_text === null && review.private_text === null && comments.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('panel.guests.card.noText')}</p>;
  }
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">{t('panel.guests.card.fullReview')}</summary>
      <div className="mt-2 flex flex-col gap-2">
        {review.public_text === null ? null : (
          <p className="whitespace-pre-line">{review.public_text}</p>
        )}
        {review.private_text === null ? null : (
          <p className="whitespace-pre-line">
            <span className="text-xs text-muted-foreground">
              {t('panel.guests.card.privateOnly')}{' '}
            </span>
            {review.private_text}
          </p>
        )}
        {comments.map(([category, comment]) => (
          <p key={category}>
            <span className="text-xs text-muted-foreground">
              {t(`panel.guests.category.${category}`)}:{' '}
            </span>
            {comment}
          </p>
        ))}
        {review.text_truncated ? (
          <p className="text-xs text-muted-foreground">{t('panel.guests.card.truncated')}</p>
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
    <DetailSection title={t('panel.guests.card.onPlace')} level={4}>
      <ul className="flex flex-col gap-1">
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
    </DetailSection>
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
    words ??
      `${t(`panel.guests.kind.${finding.kind}`)}: ${t(`panel.guests.subject.${finding.subject}`)}`,
  );
  // The model's proposal to start from; the manager's choice is on the scale of four (20261115140000).
  const [priority, setPriority] = useState<ProblemLevel>(finding.urgency);
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
      // Critical goes as high with the flag (20261115090000).
      ...storedUrgency(priority),
      description: description.trim() === '' ? undefined : description.trim(),
      assigneeId: assigneeId === '' ? undefined : assigneeId,
      scheduledDate: date,
    });
  };

  // One column on its own ground: what the task will be, then the two other ways out, each under
  // a line — no field half the card away from its label.
  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={create}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3"
      >
        <Label className="flex flex-col items-stretch gap-1.5 col-span-full">
          {t('panel.guests.decide.title')}
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            className="bg-background"
          />
        </Label>
        <Label className="flex flex-col items-stretch gap-1.5">
          {t('panel.guests.decide.priority')}
          <NativeSelect
            value={priority}
            onChange={(e) => setPriority(e.target.value as ProblemLevel)}
            className="w-full bg-background"
          >
            {PROBLEM_LEVELS.map((p) => (
              <option key={p} value={p}>
                {t(`problems.priorities.${p}`)}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="flex flex-col items-stretch gap-1.5">
          {t('panel.guests.decide.assignee')}
          <NativeSelect
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="w-full bg-background"
          >
            <option value="">{t('panel.guests.decide.toOpen')}</option>
            {(staff.data ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name ?? t('panel.problems.unknownPerson')}
              </option>
            ))}
          </NativeSelect>
        </Label>
        {assigneeId === '' ? null : (
          <Label className="flex flex-col items-stretch gap-1.5 col-span-full">
            {t('panel.guests.decide.date')}
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-background"
            />
          </Label>
        )}
        <Label className="flex flex-col items-stretch gap-1.5 col-span-full">
          {t('panel.guests.decide.description')}
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4000}
            className="bg-background"
          />
        </Label>
        <Button type="submit" disabled={approve.isPending} className="h-10 col-span-full">
          {assigneeId === ''
            ? t('panel.guests.decide.createOpen')
            : t('panel.guests.decide.createAssigned')}
        </Button>
      </form>

      {open.length + fixed.length === 0 ? null : (
        <div className="flex flex-wrap items-end gap-2 border-t pt-4">
          <Label className="flex min-w-0 flex-1 flex-col items-stretch gap-1.5">
            {t('panel.guests.decide.linkTo')}
            <NativeSelect
              value={linkId}
              onChange={(e) => setLinkId(e.target.value)}
              className="w-full bg-background"
            >
              <option value="">—</option>
              {[...open, ...fixed].map((row) => (
                <option key={row.id} value={row.id}>
                  {(row.is_open ? t('panel.guests.decide.same') : t('panel.guests.decide.fixed')) +
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
            {t('panel.guests.decide.link')}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t pt-4">
        <Label className="flex min-w-0 flex-1 flex-col items-stretch gap-1.5">
          {t('panel.guests.decide.rejectReason')}
          <NativeSelect
            value={reason}
            onChange={(e) => setReason(e.target.value as RejectReason)}
            className="w-full bg-background"
          >
            {REJECT_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`panel.guests.reason.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Button
          variant="outline"
          disabled={reject.isPending}
          onClick={() => reject.mutate({ findingId: finding.id, reason })}
        >
          {t('panel.guests.decide.reject')}
        </Button>
      </div>

      {approve.isError ? <ErrorState error={approve.error} /> : null}
      {reject.isError ? <ErrorState error={reject.error} /> : null}
    </div>
  );
}
