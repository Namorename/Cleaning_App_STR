'use client';

import type { Language } from '@str-ops/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { serverErrorKey, serverErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import { CodeWarning } from './code-warning';
import { KbPreview } from './kb-preview';
import { knowledgeKeys } from './keys';
import { PlacementField } from './placement-field';
import { RevisionHistory } from './revision-history';
import {
  draftOf,
  emptyDraft,
  isSameDraft,
  type Article,
  type ArticleDraft,
  type KbStatus,
  type Place,
} from './schema';
import { TextEditor, textIn } from './text-editor';
import {
  useArticle,
  usePlaces,
  useRestoreRevision,
  useSaveArticle,
  useSetArticleStatus,
} from './use-knowledge';

interface ArticleEditorProps {
  /** The article open; null while a new one is being written. */
  articleId: string | null;
  onClose: () => void;
  /** A new article was saved for the first time: from now on it is opened by its id. */
  onCreated: (id: string) => void;
}

/**
 * One article, written and placed (docs/knowledge-base-step1.md, «Панель»):
 * the warning about access codes, the original and its translations in tabs,
 * where it shows, the preview as the phone will draw it, the status, and the
 * versions. Only «Сохранить» writes — a new article does not exist until then.
 */
export function ArticleEditor({ articleId, onClose, onCreated }: ArticleEditorProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const article = useArticle(articleId);
  const places = usePlaces();
  const [newId] = useState(() => crypto.randomUUID());

  if (articleId !== null && article.isPending) {
    return <LoadingState>{t('panel.knowledge.editor.loading')}</LoadingState>;
  }
  if (articleId !== null && article.isError) {
    return <ErrorState message={t('panel.knowledge.editor.loadError')} error={article.error} />;
  }
  const loaded = articleId === null ? null : (article.data ?? null);
  if (articleId !== null && loaded === null) {
    return (
      <div className="flex flex-col gap-2">
        <BackButton onClose={onClose} />
        <EmptyState>{t('panel.knowledge.editor.notFound')}</EmptyState>
      </div>
    );
  }

  const initial = loaded === null ? emptyDraft(newId, language) : draftOf(loaded);
  return (
    <EditorForm
      // A new version from the server (a save, a colleague's) starts the form afresh.
      key={`${initial.id}:${loaded?.rev ?? 0}`}
      initial={initial}
      article={loaded}
      places={places.data ?? []}
      isPlacesPending={places.isPending}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

function BackButton({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Button type="button" variant="ghost" className="h-11 self-start" onClick={onClose}>
      <ChevronLeft aria-hidden="true" />
      {t('panel.knowledge.editor.back')}
    </Button>
  );
}

interface EditorFormProps {
  initial: ArticleDraft;
  /** The article as the server has it; null for a new one. */
  article: Article | null;
  places: readonly Place[];
  isPlacesPending: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

function EditorForm({
  initial,
  article,
  places,
  isPlacesPending,
  onClose,
  onCreated,
}: EditorFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<Language>(initial.language);
  const [failure, setFailure] = useState<unknown>(null);
  const save = useSaveArticle();
  const setStatus = useSetArticleStatus();
  const restore = useRestoreRevision();

  const isNew = article === null;
  const isDirty = isNew || !isSameDraft(draft, initial);
  const isBusy = save.isPending || setStatus.isPending || restore.isPending;
  const hasTitle = draft.title.trim() !== '';
  const status: KbStatus = article?.status ?? 'draft';
  const shown = textIn(draft, tab);
  const error = failure === null ? null : serverErrorText(failure);
  const isConflict = serverErrorKey(failure) === 'serverErrors.kbArticleChanged';

  /** Writes what is on screen, if anything changed; false when the server refused. */
  const persist = async (): Promise<boolean> => {
    if (!isDirty) {
      return true;
    }
    try {
      await save.mutateAsync({ draft, expectedRev: article?.rev ?? null });
      if (isNew) {
        onCreated(draft.id);
      }
      return true;
    } catch (caught) {
      setFailure(caught);
      return false;
    }
  };

  const onSave = async () => {
    setFailure(null);
    await persist();
  };

  // Publishing an edited article saves it first: what goes out is what is on screen.
  const onStatus = async (next: KbStatus) => {
    setFailure(null);
    if (!(await persist())) {
      return;
    }
    try {
      await setStatus.mutateAsync({ id: draft.id, status: next });
    } catch (caught) {
      setFailure(caught);
    }
  };

  const onRestore = async (rev: number) => {
    if (article === null) {
      return;
    }
    setFailure(null);
    try {
      await restore.mutateAsync({ id: article.id, rev, expectedRev: article.rev });
    } catch (caught) {
      setFailure(caught);
    }
  };

  // Somebody saved it meanwhile: read it again, which starts the form afresh.
  const reload = () => {
    setFailure(null);
    void queryClient.invalidateQueries({ queryKey: knowledgeKeys.article(draft.id) });
    void queryClient.invalidateQueries({ queryKey: knowledgeKeys.revisions(draft.id) });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <BackButton onClose={onClose} />
        <Badge variant={status === 'published' ? 'default' : 'outline'}>
          {t(`panel.knowledge.status.${status}`)}
        </Badge>
        {article === null ? null : (
          <span className="text-sm text-muted-foreground">
            {t('panel.knowledge.editor.version', { rev: article.rev })}
          </span>
        )}
      </div>

      <CodeWarning />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <TextEditor draft={draft} onChange={setDraft} tab={tab} onTabChange={setTab} />

          <PlacementField
            scope={draft.scope}
            propertyIds={draft.propertyIds}
            places={places}
            isPlacesPending={isPlacesPending}
            onChange={({ scope, propertyIds }) => setDraft({ ...draft, scope, propertyIds })}
          />

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className="h-11"
                disabled={isBusy || !hasTitle || !isDirty}
                focusableWhenDisabled
                onClick={() => void onSave()}
              >
                {t('panel.knowledge.editor.save')}
              </Button>
              {status === 'archived' ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={isBusy || !hasTitle}
                  focusableWhenDisabled
                  onClick={() => void onStatus('draft')}
                >
                  {t('panel.knowledge.editor.unarchive')}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={isBusy || !hasTitle}
                    focusableWhenDisabled
                    onClick={() => void onStatus(status === 'published' ? 'draft' : 'published')}
                  >
                    {status === 'published'
                      ? t('panel.knowledge.editor.unpublish')
                      : t('panel.knowledge.editor.publish')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={isBusy || !hasTitle}
                    focusableWhenDisabled
                    onClick={() => void onStatus('archived')}
                  >
                    {t('panel.knowledge.editor.archive')}
                  </Button>
                </>
              )}
              {!isNew && isDirty ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11"
                  disabled={isBusy}
                  onClick={() => setDraft(initial)}
                >
                  {t('panel.knowledge.editor.discard')}
                </Button>
              ) : null}
            </div>
            <p role="status" className="text-xs text-muted-foreground">
              {!isNew && isDirty
                ? t('panel.knowledge.editor.unsaved')
                : status === 'published'
                  ? null
                  : t('panel.knowledge.editor.publishHint')}
            </p>
            {error === null ? null : (
              <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
                <p>
                  {error.text}
                  {error.detail === null ? null : (
                    <span className="block text-xs text-muted-foreground">{error.detail}</span>
                  )}
                </p>
                {isConflict ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 self-start"
                    onClick={reload}
                  >
                    {t('panel.knowledge.editor.reload')}
                  </Button>
                ) : null}
              </div>
            )}
          </div>

          {article === null ? null : (
            <RevisionHistory
              articleId={article.id}
              currentRev={article.rev}
              isDirty={isDirty}
              isBusy={isBusy}
              onRestore={(rev) => void onRestore(rev)}
            />
          )}
        </div>

        <div className="min-w-0 xl:sticky xl:top-4">
          <KbPreview title={shown.title} body={shown.body} language={tab} />
        </div>
      </div>
    </div>
  );
}
