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
import { useLeaveGuard } from '@/lib/use-leave-guard';

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
 * versions. Only «Сохранить» writes — a new article does not exist until then —
 * and leaving with changes unsaved is asked first (useLeaveGuard).
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
  // A failed read again — the window's focus, a lost connection — keeps the
  // article read before, as TanStack does, and the form with what is typed.
  if (articleId !== null && article.isError && article.data === undefined) {
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
      // One form an article: a refetch — a colleague's save, the window
      // regaining focus — does not throw away what is being typed.
      key={initial.id}
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
  /** The article as the server has it now; null while the address says «new». */
  article: Article | null;
  places: readonly Place[];
  isPlacesPending: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

/** What the form stands on: the draft last read or saved, and the article it was. */
interface Baseline {
  draft: ArticleDraft;
  /** The article's updated_at as the screen knows it; null for one never saved. */
  token: string | null;
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
  const [baseline, setBaseline] = useState<Baseline>({
    draft: initial,
    token: article?.updated_at ?? null,
  });
  const [tab, setTab] = useState<Language>(initial.language);
  const [failure, setFailure] = useState<unknown>(null);
  const [isJustSaved, setIsJustSaved] = useState(false);
  const save = useSaveArticle();
  const setStatus = useSetArticleStatus();
  const restore = useRestoreRevision();

  const isUnsaved = baseline.token === null;
  const hasEdits = !isSameDraft(draft, baseline.draft);
  const isDirty = isUnsaved || hasEdits;
  const isBusy = save.isPending || setStatus.isPending || restore.isPending;
  // Only what was typed is asked about: a new article left untouched loses nothing.
  const confirmLeave = useLeaveGuard(hasEdits, t('panel.knowledge.editor.leaveConfirm'));
  const hasTitle = draft.title.trim() !== '';
  const status: KbStatus = article?.status ?? 'draft';
  const shown = textIn(draft, tab);
  const error = failure === null ? null : serverErrorText(failure);
  const isConflict = serverErrorKey(failure) === 'serverErrors.kbArticleChanged';

  /** The form afresh from what the server has now: after a version comes back, or a conflict. */
  const resetFromServer = async () => {
    await queryClient.refetchQueries({ queryKey: knowledgeKeys.article(draft.id) });
    const fresh = queryClient.getQueryData<Article | null>(knowledgeKeys.article(draft.id));
    if (fresh !== undefined && fresh !== null) {
      const next = draftOf(fresh);
      setDraft(next);
      setBaseline({ draft: next, token: fresh.updated_at });
    }
  };

  /** Writes what is on screen, if anything changed; false when the server refused. */
  const persist = async (): Promise<boolean> => {
    if (!isDirty) {
      return true;
    }
    const sent = draft;
    try {
      const written = await save.mutateAsync({ draft: sent, expectedUpdatedAt: baseline.token });
      setBaseline({ draft: sent, token: written.updated_at });
      return true;
    } catch (caught) {
      setFailure(caught);
      return false;
    }
  };

  // A new article is opened by its id only once the whole action is done: the
  // address change replaces this form, and a refusal must still be on screen.
  const opened = () => {
    if (article === null) {
      onCreated(draft.id);
    }
  };

  const onSave = async () => {
    setFailure(null);
    if (await persist()) {
      setIsJustSaved(true);
      opened();
    }
  };

  // Publishing an edited article saves it first: what goes out is what is on screen.
  const onStatus = async (next: KbStatus) => {
    setFailure(null);
    if (!(await persist())) {
      return;
    }
    try {
      const written = await setStatus.mutateAsync({ id: draft.id, status: next });
      setBaseline((current) => ({ ...current, token: written.updated_at }));
      opened();
    } catch (caught) {
      setFailure(caught);
    }
  };

  const onRestore = async (rev: number) => {
    if (baseline.token === null) {
      return;
    }
    setFailure(null);
    try {
      await restore.mutateAsync({ id: draft.id, rev, expectedUpdatedAt: baseline.token });
      await resetFromServer();
    } catch (caught) {
      setFailure(caught);
    }
  };

  // Somebody saved it meanwhile: the latest version replaces what is on screen.
  const reload = () => {
    setFailure(null);
    void resetFromServer();
    void queryClient.invalidateQueries({ queryKey: knowledgeKeys.revisions(draft.id) });
  };

  const change = (next: ArticleDraft) => {
    setIsJustSaved(false);
    setDraft(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <BackButton
          onClose={() => {
            if (confirmLeave()) {
              onClose();
            }
          }}
        />
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
          <TextEditor draft={draft} onChange={change} tab={tab} onTabChange={setTab} />

          <PlacementField
            scope={draft.scope}
            propertyIds={draft.propertyIds}
            places={places}
            isPlacesPending={isPlacesPending}
            onChange={({ scope, propertyIds }) => change({ ...draft, scope, propertyIds })}
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
              {!isUnsaved && isDirty ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11"
                  disabled={isBusy}
                  onClick={() => change(baseline.draft)}
                >
                  {t('panel.knowledge.editor.discard')}
                </Button>
              ) : null}
            </div>
            <p role="status" className="text-xs text-muted-foreground">
              {!isUnsaved && isDirty
                ? t('panel.knowledge.editor.unsaved')
                : isJustSaved
                  ? t('panel.knowledge.editor.saved')
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
