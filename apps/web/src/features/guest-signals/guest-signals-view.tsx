'use client';

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
import { formatDateTime } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import { FindingCard } from './finding-card';
import {
  DAILY_AUTO_CAP_MAX,
  DAILY_AUTO_CAP_MIN,
  FINDING_TABS,
  freshness,
  monthOf,
  placePathOf,
  SUBJECTS,
  TASK_KINDS,
  type FindingKind,
  type FindingTab,
  type Review,
  type SignalSettings,
} from './schema';
import {
  useAddFinding,
  useCandidateCount,
  useFindings,
  useReviewList,
  useRunStatus,
  useSignalSettings,
  useUpdateSettings,
} from './use-guest-signals';

type Tab = FindingTab | 'all' | 'settings';
const TABS: readonly Tab[] = [...(Object.keys(FINDING_TABS) as FindingTab[]), 'all', 'settings'];

interface GuestSignalsViewProps {
  /** The switches are the admin's (the owner's decisions of 2026-10-17); the server says so too. */
  isAdmin: boolean;
}

/**
 * «Гости» (docs/guest-signals.md §7.2, the owner's decision 2): what the readers
 * found in what guests wrote, every review, the switches. Reviews only until
 * messages are loaded (stages 3–4), so there is no «Отзывы / Сообщения» filter yet.
 */
export function GuestSignalsView({ isAdmin }: GuestSignalsViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('found');
  const count = useCandidateCount();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('panel.guests.title')} meta={<RunLine />} />
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          {TABS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`panel.guests.tabs.${key}`)}
              {key === 'found' && (count.data ?? 0) > 0 ? ` ${count.data}` : ''}
            </TabsTrigger>
          ))}
        </TabsList>
        {(Object.keys(FINDING_TABS) as FindingTab[]).map((key) => (
          <TabsContent key={key} value={key}>
            {tab === key ? <FindingList tab={key} /> : null}
          </TabsContent>
        ))}
        <TabsContent value="all">{tab === 'all' ? <AllReviews /> : null}</TabsContent>
        <TabsContent value="settings">
          {tab === 'settings' ? <SettingsPanel isAdmin={isAdmin} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** «Обновлено 07:21», and a warning when two days went by without a clean run. */
function RunLine() {
  const { t } = useTranslation();
  const language = useLanguage();
  const status = useRunStatus();
  if (status.data === undefined) {
    return null;
  }
  const { lastOk, isStale } = freshness(status.data);
  return (
    <span className={isStale ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
      {lastOk === null
        ? t('panel.guests.neverRan')
        : t(isStale ? 'panel.guests.stale' : 'panel.guests.updated', {
            at: formatDateTime(lastOk, language),
          })}
    </span>
  );
}

function FindingList({ tab }: { tab: FindingTab }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const findings = useFindings(tab);
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

function AllReviews() {
  const { t } = useTranslation();
  const reviews = useReviewList();
  if (reviews.isPending) {
    return <LoadingState />;
  }
  if (reviews.isError) {
    return <ErrorState error={reviews.error} />;
  }
  if (reviews.data.length === 0) {
    return <EmptyState>{t('panel.guests.empty.all')}</EmptyState>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {reviews.data.map((review) => (
        <ReviewRow key={review.id} review={review} />
      ))}
    </ul>
  );
}

function ReviewRow({ review }: { review: Review }) {
  const { t } = useTranslation();
  const hasText = review.public_text !== null || review.private_text !== null;
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
      {review.property_id === null ? null : <AddByHand signalId={review.id} />}
    </li>
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
        {value.notice_published_at === null
          ? t('panel.guests.settings.noNotice')
          : t('panel.guests.settings.notice', {
              at: formatDateTime(value.notice_published_at, language),
            })}
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
