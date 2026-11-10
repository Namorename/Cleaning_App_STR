'use client';

import { INTL_LOCALES } from '@str-ops/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAnalyticsListings } from '@/features/analytics/use-analytics';
import { wholeAsAll } from '@/features/analytics/whole-lists';
import { formatDateTime, formatDay } from '@/lib/format-date';
import { useAddressState } from '@/lib/use-address-state';
import { useLanguage } from '@/lib/use-language';

import { REVIEWS_PAGE_SIZE } from './api';
import { FindingCard } from './finding-card';
import {
  EMPTY_REVIEW_FILTERS,
  GUEST_TABS,
  hasReviewFilters,
  readGuestsAddress,
  reviewFiltersKey,
  withOrderedBounds,
  writeGuestsAddress,
  type GuestTab,
  type ReviewFilters,
} from './review-filters';
import { ReviewFiltersBar } from './review-filters-bar';
import {
  chatFreshness,
  DAILY_AUTO_CAP_MAX,
  DAILY_AUTO_CAP_MIN,
  EVERY_STAGE,
  expectedStages,
  FINDING_TABS,
  freshness,
  kindsOf,
  monthOf,
  placePathOf,
  SUBJECTS,
  TASK_KINDS,
  textsFromDay,
  type FindingKind,
  type FindingTab,
  type Review,
  type SignalSettings,
  type SignalSource,
} from './schema';
import {
  useAddFinding,
  useCandidateCount,
  useChatsOn,
  useFindings,
  useHasReviewText,
  useReviewPage,
  useReviewText,
  useRunStatus,
  useSignalSettings,
  useUpdateSettings,
} from './use-guest-signals';

interface GuestSignalsViewProps {
  /** The switches are the admin's (the owner's decisions of 2026-10-17); the server says so too. */
  isAdmin: boolean;
}

/**
 * «Гости» (docs/guest-signals.md §7.2, the owner's decision 2): what the readers
 * found in what guests wrote, every review, the switches. While chats are on
 * (docs/guest-chats.md) the cards of messages stand beside the reviews' with a
 * «Отзывы / Сообщения» filter; off, they are not shown at all.
 *
 * The tab and the filters of «Все отзывы» live in the address, as on the
 * other screens: a reload, a forwarded link or «Назад» find the screen as it
 * was. A new tab is a step of the history; a filter is changed in place.
 */
export function GuestSignalsView({ isAdmin }: GuestSignalsViewProps) {
  const { t } = useTranslation();
  const [address, setAddress] = useAddressState(readGuestsAddress, writeGuestsAddress);
  const { tab } = address;
  const setTab = (next: GuestTab) => setAddress({ ...address, tab: next }, 'push');
  const setReviewFilters = (next: ReviewFilters) => setAddress({ ...address, reviews: next });
  const count = useCandidateCount();
  const chats = useChatsOn();
  const chatsOn = chats.data === true;
  const [source, setSource] = useState<SignalSource>('all');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('panel.guests.title')} meta={<RunLine chatsOn={chatsOn} />} />
      <Tabs value={tab} onValueChange={(value) => setTab(value as GuestTab)}>
        <TabsList>
          {GUEST_TABS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`panel.guests.tabs.${key}`)}
              {key === 'found' && (count.data ?? 0) > 0 ? ` ${count.data}` : ''}
            </TabsTrigger>
          ))}
        </TabsList>
        {(Object.keys(FINDING_TABS) as FindingTab[]).map((key) => (
          <TabsContent key={key} value={key}>
            {tab === key ? (
              <div className="flex flex-col gap-3">
                {chatsOn ? <SourcePicker value={source} onChange={setSource} /> : null}
                <FindingList tab={key} kinds={kindsOf(source, chatsOn)} />
              </div>
            ) : null}
          </TabsContent>
        ))}
        <TabsContent value="all">
          {tab === 'all' ? (
            <AllReviews filters={address.reviews} onFiltersChange={setReviewFilters} />
          ) : null}
        </TabsContent>
        <TabsContent value="settings">
          {tab === 'settings' ? <SettingsPanel isAdmin={isAdmin} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * «Обновлено 07:21», and under it a red line for each job that failed, did
 * not come after the load, or has had no clean run for over a day — the load
 * and the reading judged apart, so one's clean run never hides the other.
 */
function RunLine({ chatsOn }: { chatsOn: boolean }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const status = useRunStatus();
  const chats = useRunStatus('message', chatsOn);
  const settings = useSignalSettings();
  if (status.isError) {
    return <ErrorState message={t('panel.guests.runs.unknown')} error={status.error} />;
  }
  if (status.data === undefined || settings.isPending) {
    return null;
  }
  const expected = settings.data === undefined ? EVERY_STAGE : expectedStages(settings.data);
  const { updatedAt, problems } = freshness(status.data, expected);
  return (
    <div className="flex flex-col text-sm">
      <span className="text-muted-foreground">
        {updatedAt === null
          ? t('panel.guests.neverRan')
          : t('panel.guests.updated', { at: formatDateTime(updatedAt, language) })}
      </span>
      {problems.map((problem) => (
        <span key={problem.kind} className="text-destructive">
          {t(`panel.guests.runs.${problem.kind}`, { at: formatDateTime(problem.at, language) })}
        </span>
      ))}
      {chatsOn && chats.data !== undefined ? <ChatLine status={chats.data} /> : null}
    </div>
  );
}

/** The chats' own line: read every few minutes, so a tick that failed or stopped shows the same day. */
function ChatLine({ status }: { status: Parameters<typeof chatFreshness>[0] }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { updatedAt, problem, at } = chatFreshness(status);
  return (
    <>
      <span className="text-muted-foreground">
        {updatedAt === null
          ? t('panel.guests.chats.neverRan')
          : t('panel.guests.chats.updated', { at: formatDateTime(updatedAt, language) })}
      </span>
      {problem === null || at === null ? null : (
        <span className="text-destructive">
          {t(`panel.guests.chats.${problem}`, { at: formatDateTime(at, language) })}
        </span>
      )}
    </>
  );
}

/** «Все / Отзывы / Сообщения»: shown only while chats are on. */
function SourcePicker({
  value,
  onChange,
}: {
  value: SignalSource;
  onChange: (next: SignalSource) => void;
}) {
  const { t } = useTranslation();
  return (
    <Label className="flex w-full flex-col items-start gap-1 sm:w-64">
      {t('panel.guests.source.label')}
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value as SignalSource)}>
        {(['all', 'review', 'message'] as const).map((option) => (
          <option key={option} value={option}>
            {t(`panel.guests.source.${option}`)}
          </option>
        ))}
      </NativeSelect>
    </Label>
  );
}

function FindingList({ tab, kinds }: { tab: FindingTab; kinds: ReturnType<typeof kindsOf> }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const findings = useFindings(tab, kinds);
  if (findings.isPending) {
    return <LoadingState />;
  }
  if (findings.isError) {
    return <ErrorState error={findings.error} />;
  }
  if (findings.data.length === 0) {
    return <EmptyState>{t(`panel.guests.empty.${tab}`)}</EmptyState>;
  }
  return (
    <div className="flex flex-col gap-3">
      {findings.data.map((finding) => (
        <FindingCard key={finding.id} finding={finding} language={language} />
      ))}
    </div>
  );
}

interface AllReviewsProps {
  filters: ReviewFilters;
  onFiltersChange: (filters: ReviewFilters) => void;
}

/** «Все отзывы»: the filters, and the reviews they let through a page at a time. */
function AllReviews({ filters, onFiltersChange }: AllReviewsProps) {
  const language = useLanguage();
  const { t } = useTranslation();
  const listings = useAnalyticsListings();
  const places = (listings.data ?? []).map((listing) => ({
    id: String(listing.id),
    label:
      listing.status === 'archived'
        ? t('panel.analytics.filters.archivedListing', { name: listing.name })
        : listing.name,
  }));
  // Every listing ticked narrows nothing (as on «Аналитика»): a review whose
  // listing is unknown stays in the list instead of dropping out of it.
  const ordered = withOrderedBounds({
    ...filters,
    placeIds: [
      ...wholeAsAll(
        filters.placeIds,
        places.map((place) => Number(place.id)),
      ),
    ],
  });

  return (
    <div className="flex flex-col gap-3">
      <ReviewFiltersBar
        filters={filters}
        onChange={onFiltersChange}
        places={places}
        language={language}
      />
      {/* A new set of filters starts the pager over: the list is keyed by them. */}
      <ReviewList
        key={reviewFiltersKey(ordered)}
        filters={ordered}
        onReset={() => onFiltersChange(EMPTY_REVIEW_FILTERS)}
      />
    </div>
  );
}

interface ReviewListProps {
  filters: ReviewFilters;
  onReset: () => void;
}

function ReviewList({ filters, onReset }: ReviewListProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const [page, setPage] = useState(0);
  const reviews = useReviewPage(filters, page);
  if (reviews.isPending) {
    return <LoadingState />;
  }
  if (reviews.isError) {
    return <ErrorState error={reviews.error} />;
  }
  const { total } = reviews.data;
  const shown = reviews.data.reviews;
  const number = (value: number) => value.toLocaleString(INTL_LOCALES[language]);

  if (shown.length === 0) {
    if (page > 0) {
      return (
        <EmptyState>
          <Button type="button" variant="outline" className="h-11" onClick={() => setPage(0)}>
            {t('panel.guests.filters.firstPage')}
          </Button>
        </EmptyState>
      );
    }
    if (!hasReviewFilters(filters)) {
      return <EmptyState>{t('panel.guests.empty.all')}</EmptyState>;
    }
    return (
      <EmptyState>
        <span className="flex flex-col items-center gap-2">
          {t('panel.guests.filters.empty')}
          <Button type="button" variant="outline" className="h-11" onClick={onReset}>
            {t('panel.guests.filters.reset')}
          </Button>
        </span>
      </EmptyState>
    );
  }

  // The range of the rows on screen: while the next page loads, the previous
  // one stays shown (keepPreviousData), and so does its range.
  const first = reviews.data.page * REVIEWS_PAGE_SIZE + 1;
  const last = reviews.data.page * REVIEWS_PAGE_SIZE + shown.length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t('panel.guests.filters.total', { count: total, total: number(total) })}
      </p>
      <ul className="flex flex-col gap-2">
        {shown.map((review) => (
          <ReviewRow key={review.id} review={review} />
        ))}
      </ul>
      {total > REVIEWS_PAGE_SIZE ? (
        <nav
          aria-label={t('panel.guests.tabs.all')}
          className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"
        >
          <span>
            {t('panel.analytics.pagination.range', {
              from: number(first),
              to: number(last),
              total: number(total),
            })}
          </span>
          <span className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={page === 0 || reviews.isPlaceholderData}
              onClick={() => setPage(page - 1)}
            >
              {t('panel.analytics.pagination.previous')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={last >= total || reviews.isPlaceholderData}
              onClick={() => setPage(page + 1)}
            >
              {t('panel.analytics.pagination.next')}
            </Button>
          </span>
        </nav>
      ) : null}
    </div>
  );
}

function ReviewRow({ review }: { review: Review }) {
  const { t } = useTranslation();
  const hasText = review.public_text !== null || review.private_text !== null;
  const categories = Object.entries(review.category_ratings)
    .map(([key, value]) => `${t(`panel.guests.category.${key}`)} ${value}`)
    .join(' · ');
  return (
    <li className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="font-medium">
          {placePathOf(review.place) ?? t('panel.guests.card.noPlace')}
        </span>
        <span>
          {review.rating === null ? t('panel.guests.card.noRating') : `${review.rating}/10`}
        </span>
        <span>{t(`panel.guests.channel.${review.channel}`)}</span>
        <span className="text-muted-foreground">
          {monthOf(review.departure_date) ?? monthOf(review.submitted_at)}
        </span>
        {review.is_hidden ? (
          <span className="text-muted-foreground">{t('panel.guests.hidden')}</span>
        ) : null}
      </div>
      {categories === '' ? null : (
        <p className="mt-1 text-xs text-muted-foreground">{categories}</p>
      )}
      {hasText ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-muted-foreground">
            {t('panel.guests.card.fullReview')}
          </summary>
          {review.public_text === null ? null : (
            <p className="mt-1 whitespace-pre-line">{review.public_text}</p>
          )}
          {review.private_text === null ? null : (
            <p className="mt-1 whitespace-pre-line">
              <span className="text-xs text-muted-foreground">
                {t('panel.guests.card.privateOnly')}{' '}
              </span>
              {review.private_text}
            </p>
          )}
        </details>
      ) : null}
      {!hasText && (review.has_public_text || review.has_private_text) ? (
        <TextFromPms signalId={review.id} />
      ) : null}
      {review.property_id === null ? null : <AddByHand signalId={review.id} />}
    </li>
  );
}

/**
 * The words of a review woom does not keep (a stay before the texts' line,
 * or texts off), read from Hostaway when the manager asks — the original, as
 * in Hostaway — and held by this page alone (docs/guest-review-text.md).
 */
function TextFromPms({ signalId }: { signalId: string }) {
  const { t } = useTranslation();
  // A row back on screen (another page, another tab) shows what this page read.
  const isRead = useHasReviewText(signalId);
  const [asked, setAsked] = useState(isRead);
  const text = useReviewText(signalId, asked);
  if (!asked) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => setAsked(true)}
      >
        {t('panel.guests.liveText.show')}
      </Button>
    );
  }
  if (text.isPending) {
    return (
      <p className="mt-2 text-muted-foreground" aria-live="polite">
        {t('panel.guests.liveText.loading')}
      </p>
    );
  }
  if (text.isError) {
    // The limit and the PMS both say «try again»: the button is here, the
    // read is the manager's to repeat (each one is counted).
    return (
      <div className="mt-2 flex flex-col items-start gap-2">
        <ErrorState error={text.error} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={text.isFetching}
          onClick={() => void text.refetch()}
        >
          {t('panel.guests.liveText.retry')}
        </Button>
      </div>
    );
  }
  const { public_text: publicText, private_text: privateText } = text.data;
  const comments = Object.entries(text.data.category_comments);
  const isEmpty = publicText === null && privateText === null && comments.length === 0;
  return (
    <div className="mt-2 flex flex-col gap-1" aria-live="polite">
      <p className="text-xs text-muted-foreground">{t('panel.guests.liveText.note')}</p>
      {isEmpty ? <p>{t('panel.guests.liveText.empty')}</p> : null}
      {publicText === null ? null : <p className="whitespace-pre-line">{publicText}</p>}
      {privateText === null ? null : (
        <p className="whitespace-pre-line">
          <span className="text-xs text-muted-foreground">
            {t('panel.guests.card.privateOnly')}{' '}
          </span>
          {privateText}
        </p>
      )}
      {comments.map(([category, comment]) => (
        <p key={category} className="whitespace-pre-line">
          <span className="text-xs text-muted-foreground">
            {t(`panel.guests.category.${category}`)}:{' '}
          </span>
          {comment}
        </p>
      ))}
    </div>
  );
}

/** «Создать задание из отзыва» by hand: the manager names the kind, the subject and the title. */
function AddByHand({ signalId }: { signalId: string }) {
  const { t } = useTranslation();
  const add = useAddFinding();
  const [kind, setKind] = useState<FindingKind>('repair');
  const [subject, setSubject] = useState<string>('other');
  const [title, setTitle] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate({ signalId, kind, subject, title: title.trim() });
  };

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm">{t('panel.guests.addByHand')}</summary>
      <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2">
        <Label className="flex flex-col items-start gap-1">
          {t('panel.guests.kindLabel')}
          <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as FindingKind)}>
            {TASK_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`panel.guests.kind.${k}`)}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="flex flex-col items-start gap-1">
          {t('panel.guests.subjectLabel')}
          <NativeSelect value={subject} onChange={(e) => setSubject(e.target.value)}>
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>
                {t(`panel.guests.subject.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="flex flex-col items-start gap-1">
          {t('panel.guests.decide.title')}
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
          />
        </Label>
        <Button type="submit" disabled={add.isPending || title.trim() === ''}>
          {t('panel.guests.decide.createOpen')}
        </Button>
      </form>
      {add.isError ? <ErrorState error={add.error} /> : null}
    </details>
  );
}

const SWITCHES = [
  ['sync_enabled', 'syncEnabled'],
  ['texts_enabled', 'textsEnabled'],
  ['tasks_enabled', 'tasksEnabled'],
  ['model_enabled', 'modelEnabled'],
] as const;

/** The switches, in the order the steps go on; a manager sees them and may take a kind out of auto only. */
function SettingsPanel({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const settings = useSignalSettings();
  const update = useUpdateSettings();
  if (settings.isPending) {
    return <LoadingState />;
  }
  if (settings.isError) {
    return <ErrorState error={settings.error} />;
  }
  const value: SignalSettings = settings.data;
  const textsDay = textsFromDay(value);

  return (
    <div className="flex max-w-xl flex-col gap-4 text-sm">
      {isAdmin ? null : (
        <p className="text-muted-foreground">{t('panel.guests.settings.adminOnly')}</p>
      )}
      {SWITCHES.map(([column, change]) => (
        <label key={column} className="flex items-center justify-between gap-4">
          <span>{t(`panel.guests.settings.${column}`)}</span>
          <Switch
            checked={value[column]}
            disabled={!isAdmin || update.isPending}
            onCheckedChange={(checked: boolean) => update.mutate({ [change]: checked })}
          />
        </label>
      ))}
      <p>
        {textsDay === null
          ? t('panel.guests.settings.noTextsFrom')
          : t(
              value.texts_enabled
                ? 'panel.guests.settings.textsFrom'
                : 'panel.guests.settings.textsOffFrom',
              {
                day: formatDay(textsDay, language),
              },
            )}
      </p>
      <p>
        {t('panel.guests.settings.cap', {
          cap: value.daily_model_cap,
          floor: value.min_confidence,
        })}
      </p>
      <AutoCapField
        key={value.daily_auto_cap}
        saved={value.daily_auto_cap}
        isAdmin={isAdmin}
        isBusy={update.isPending}
        onSave={(cap) => update.mutate({ dailyAutoCap: cap })}
      />
      <div className="flex flex-col gap-1">
        <span>{t('panel.guests.settings.auto')}</span>
        {value.auto_kinds.length === 0 ? (
          <span className="text-muted-foreground">{t('panel.guests.settings.autoNone')}</span>
        ) : (
          value.auto_kinds.map((kind) => (
            <span key={kind} className="flex items-center gap-2">
              {t(`panel.guests.kind.${kind}`)}
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({ autoKinds: value.auto_kinds.filter((k) => k !== kind) })
                }
              >
                {t('panel.guests.settings.autoOff')}
              </Button>
            </span>
          ))
        )}
      </div>
      {update.isError ? <ErrorState error={update.error} /> : null}
    </div>
  );
}

interface AutoCapFieldProps {
  /** The ceiling the database holds; a new one starts a fresh draft (the field is keyed by it). */
  saved: number;
  isAdmin: boolean;
  isBusy: boolean;
  onSave: (cap: number) => void;
}

/** How many tasks auto may make a day; past it the findings wait for a manager. The admin's, like the other ceilings. */
function AutoCapField({ saved, isAdmin, isBusy, onSave }: AutoCapFieldProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(saved));
  const cap = Number(draft);
  const isValid =
    draft.trim() !== '' &&
    Number.isInteger(cap) &&
    cap >= DAILY_AUTO_CAP_MIN &&
    cap <= DAILY_AUTO_CAP_MAX;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isValid) {
      onSave(cap);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <Label className="flex flex-col items-start gap-1">
        {t('panel.guests.settings.autoCap')}
        <Input
          type="number"
          inputMode="numeric"
          min={DAILY_AUTO_CAP_MIN}
          max={DAILY_AUTO_CAP_MAX}
          step={1}
          value={draft}
          disabled={!isAdmin}
          onChange={(event) => setDraft(event.target.value)}
          className="w-24"
        />
      </Label>
      <Button
        type="submit"
        variant="outline"
        disabled={!isAdmin || isBusy || !isValid || cap === saved}
      >
        {t('panel.guests.settings.autoCapSave')}
      </Button>
      <p className="w-full text-xs text-muted-foreground">
        {t('panel.guests.settings.autoCapHint', {
          min: DAILY_AUTO_CAP_MIN,
          max: DAILY_AUTO_CAP_MAX,
        })}
      </p>
    </form>
  );
}
