'use client';

import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import { usePeople, useRevisions } from './use-knowledge';

interface RevisionHistoryProps {
  articleId: string;
  currentRev: number;
  /** Unsaved changes on screen: bringing a version back would throw them away. */
  isDirty: boolean;
  isBusy: boolean;
  onRestore: (rev: number) => void;
}

/**
 * Every saved version of the text, newest first, with who and when. A version
 * is brought back as the newest one; the versions in between stay
 * (restore_kb_revision, 20261017100000).
 */
export function RevisionHistory({
  articleId,
  currentRev,
  isDirty,
  isBusy,
  onRestore,
}: RevisionHistoryProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const revisions = useRevisions(articleId);
  const people = usePeople();
  const nameOf = (id: string | null) =>
    people.data?.find((person) => person.id === id)?.full_name ??
    t('panel.knowledge.history.unknownAuthor');

  return (
    <section aria-labelledby={`${articleId}-history`} className="flex flex-col gap-2">
      <h2 id={`${articleId}-history`} className="text-lg font-semibold">
        {t('panel.knowledge.history.title')}
      </h2>
      <p className="text-xs text-muted-foreground">
        {isDirty ? t('panel.knowledge.history.saveFirst') : t('panel.knowledge.history.restoreHint')}
      </p>
      {revisions.isPending ? (
        <LoadingState>{t('common.loading')}</LoadingState>
      ) : revisions.isError ? (
        <ErrorState message={t('panel.knowledge.history.loadError')} error={revisions.error} />
      ) : revisions.data.length === 0 ? (
        <EmptyState>{t('panel.knowledge.history.empty')}</EmptyState>
      ) : (
        <ol className="flex flex-col divide-y rounded-lg border">
          {revisions.data.map((revision) => {
            const isCurrent = revision.rev === currentRev;
            return (
              <li key={revision.rev} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <span className="font-medium tabular-nums">
                  {t('panel.knowledge.editor.version', { rev: revision.rev })}
                </span>
                {isCurrent ? (
                  <Badge variant="secondary">{t('panel.knowledge.history.current')}</Badge>
                ) : null}
                <span className="min-w-0 flex-1 truncate" lang={revision.language}>
                  {revision.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {nameOf(revision.edited_by)}, {formatDateTime(revision.created_at, language)}
                </span>
                {isCurrent ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isDirty || isBusy}
                    focusableWhenDisabled
                    aria-label={t('panel.knowledge.history.restoreLabel', { rev: revision.rev })}
                    onClick={() => onRestore(revision.rev)}
                  >
                    {t('panel.knowledge.history.restore')}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
