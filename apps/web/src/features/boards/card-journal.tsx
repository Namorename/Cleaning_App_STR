'use client';

import { BOARD_LIMITS, isBoardColumn } from '@str-ops/shared';
import type { TFunction } from 'i18next';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmMoveDialog } from '@/features/problems/board-dialogs';
import { formatDateTime, formatDay } from '@/lib/format-date';
import type { Language } from '@str-ops/shared';
import { serverErrorText, type ServerErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import { LinkedText } from './linked-text';
import {
  canDeleteComment,
  canEditComment,
  orderedEntries,
  type BoardViewer,
  type CardDetail,
  type CardEntry,
} from './schema';
import { useDeleteComment, useOfficePeople, useSaveComment } from './use-boards';

/** A day the server wrote, `YYYY-MM-DD`, or null. */
function dayFact(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function countFact(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** A person the server named by id; the name comes from the company's people, never the journal. */
function personFact(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** What names the ids a journal holds: the company's people, the board's columns. */
export interface EntryNames {
  /** A person by id, from the company's people; null for one not known. */
  person?: (id: string) => string | null;
  /** A column of the card's board by id, a deleted one too; null for one not read. */
  column?: (id: string) => string | null;
}

/**
 * Where a «moved» line says the card went: the column it names (20261126120000) by its name now —
 * renamed or deleted since, too — else the stage the line keeps, by the technicians' board's word.
 */
function movedTo(facts: CardEntry['facts'], t: TFunction, names: EntryNames): string {
  const { to, to_column: toColumn } = facts;
  const column = typeof toColumn === 'string' ? (names.column?.(toColumn) ?? null) : null;
  if (column !== null) {
    return column;
  }
  return typeof to === 'string' && isBoardColumn(to) ? t(`problems.statuses.${to}`) : '—';
}

/**
 * The sentence of a system line: the server keeps codes, dates, counts and
 * people's and columns' ids (never a person's words or name); the reader's
 * language makes them a sentence, and `names` names the people and columns.
 */
export function entrySentence(
  entry: CardEntry,
  t: TFunction,
  language: Language,
  names: EntryNames = {},
): string {
  const { facts } = entry;
  const person = (id: string | null) =>
    id === null ? '—' : (names.person?.(id) ?? t('boards.unknownPerson'));
  switch (entry.kind) {
    case 'assignee_changed': {
      const from = personFact(facts.from);
      const to = personFact(facts.to);
      if (from === null && to !== null) {
        return t('boards.entries.assigneeSet', { to: person(to) });
      }
      if (to === null && from !== null) {
        return t('boards.entries.assigneeRemoved', { from: person(from) });
      }
      return t('boards.entries.assigneeChanged', { from: person(from), to: person(to) });
    }
    case 'moved':
      return t('boards.entries.moved', { column: movedTo(facts, t, names) });
    case 'due_changed': {
      const from = dayFact(facts.from);
      const to = dayFact(facts.to);
      if (from === null && to !== null) {
        return t('boards.entries.dueSet', { to: formatDay(to, language) });
      }
      if (to === null && from !== null) {
        return t('boards.entries.dueRemoved', { from: formatDay(from, language) });
      }
      return t('boards.entries.dueChanged', {
        from: from === null ? '—' : formatDay(from, language),
        to: to === null ? '—' : formatDay(to, language),
      });
    }
    case 'step_done':
      return t('boards.entries.stepDone', {
        done: countFact(facts.done),
        total: countFact(facts.total),
      });
    case 'comment':
      return entry.body ?? '';
    default:
      return '';
  }
}

interface CardJournalProps {
  card: CardDetail;
  viewer: BoardViewer;
  /** Every manager and admin, on a live board and a card that is not shelved: may write. */
  canEdit: boolean;
  /** Names a column of the card's board by id, a deleted one too: a «moved» line's column. */
  columnNameOf?: (id: string) => string | null;
}

/**
 * The card's journal, oldest first and the newest at the bottom: comments
 * with their author and time (the device's clock, as every journal of the
 * project), «изменено» on a changed one, and the server's short lines — moved,
 * due date changed, step ticked. Its author changes and deletes a comment; an
 * admin deletes any. Ctrl+Enter sends.
 */
export function CardJournal({ card, viewer, canEdit, columnNameOf }: CardJournalProps) {
  const people = useOfficePeople();
  const names: EntryNames = {
    person: (id) => people.data?.find((person) => person.id === id)?.full_name ?? null,
    column: columnNameOf,
  };
  const { t } = useTranslation();
  const headingId = useId();
  const save = useSaveComment();
  const remove = useDeleteComment();
  const [body, setBody] = useState('');
  const [entryId, setEntryId] = useState(() => crypto.randomUUID());
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [deleting, setDeleting] = useState<CardEntry | null>(null);
  const entries = orderedEntries(card.entries);

  // The latest failure only: an older one never outlives a later success.
  const [failure, setFailure] = useState<ServerErrorText | null>(null);
  const outcome = (onSuccess?: () => void) => ({
    onSuccess: () => {
      setFailure(null);
      onSuccess?.();
    },
    onError: (error: unknown) => setFailure(serverErrorText(error)),
  });

  const send = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const words = body.trim();
    if (words === '' || save.isPending) {
      return;
    }
    save.mutate(
      { entryId, cardId: card.id, body: words },
      outcome(() => {
        setBody((now) => (now.trim() === words ? '' : now));
        setEntryId(crypto.randomUUID());
      }),
    );
  };

  const sendOnCtrlEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send();
    }
  };

  const saveEdit = () => {
    if (editing === null) {
      return;
    }
    const words = editing.body.trim();
    if (words === '') {
      return;
    }
    save.mutate(
      { entryId: editing.id, cardId: null, body: words },
      outcome(() => setEditing(null)),
    );
  };

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h3 id={headingId} className="text-sm font-semibold">
        {t('boards.journal')}
      </h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('boards.journalEmpty')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {entries.map((entry) => (
            <JournalLine
              names={names}
              key={entry.id}
              entry={entry}
              canEdit={canEdit && canEditComment(entry, viewer)}
              canDelete={canEdit && canDeleteComment(entry, viewer)}
              editing={editing?.id === entry.id ? editing.body : null}
              isSaving={save.isPending}
              onEdit={() => setEditing({ id: entry.id, body: entry.body ?? '' })}
              onEditChange={(next) => setEditing({ id: entry.id, body: next })}
              onEditSave={saveEdit}
              onEditCancel={() => setEditing(null)}
              onDelete={() => setDeleting(entry)}
            />
          ))}
        </ol>
      )}
      {canEdit ? (
        <form onSubmit={send} className="flex flex-col gap-2">
          <Textarea
            rows={3}
            value={body}
            maxLength={BOARD_LIMITS.comment}
            placeholder={t('boards.commentPlaceholder')}
            aria-label={t('boards.commentPlaceholder')}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={sendOnCtrlEnter}
          />
          <Button
            type="submit"
            className="h-11 self-end"
            disabled={save.isPending || body.trim() === ''}
          >
            {t('boards.addComment')}
          </Button>
        </form>
      ) : null}
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
          {failure.detail === null ? null : (
            <span className="block text-xs text-muted-foreground">{failure.detail}</span>
          )}
        </p>
      )}
      <ConfirmMoveDialog
        open={deleting !== null}
        title={t('boards.deleteCommentTitle')}
        description={t('boards.deleteCommentText')}
        confirmLabel={t('boards.deleteComment')}
        abortLabel={t('boards.cancel')}
        isDestructive
        isBusy={remove.isPending}
        onConfirm={() => {
          if (deleting !== null) {
            remove.mutate(deleting.id, { ...outcome(), onSettled: () => setDeleting(null) });
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

interface JournalLineProps {
  /** Names the people and the columns the line holds the ids of. */
  names: EntryNames;
  entry: CardEntry;
  canEdit: boolean;
  canDelete: boolean;
  editing: string | null;
  isSaving: boolean;
  onEdit: () => void;
  onEditChange: (body: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onDelete: () => void;
}

function JournalLine({
  entry,
  names,
  canEdit,
  canDelete,
  editing,
  isSaving,
  onEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
  onDelete,
}: JournalLineProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const author = entry.author?.full_name ?? t('boards.unknownPerson');
  const when = formatDateTime(entry.created_at, language);
  const isComment = entry.kind === 'comment';

  return (
    <li className="flex flex-col gap-1 border-l-2 border-border pl-3">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{author}</span> ·{' '}
        <time dateTime={entry.created_at}>{when}</time>
        {entry.edited_at === null ? null : ` · ${t('boards.edited')}`}
      </p>
      {!isComment ? (
        <p className="text-sm text-muted-foreground italic">
          {entrySentence(entry, t, language, names)}
        </p>
      ) : editing !== null ? (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            rows={3}
            value={editing}
            maxLength={BOARD_LIMITS.comment}
            aria-label={t('boards.editComment')}
            onChange={(event) => onEditChange(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onEditCancel}>
              {t('boards.cancel')}
            </Button>
            <Button
              type="button"
              className="h-11"
              disabled={isSaving || editing.trim() === ''}
              onClick={onEditSave}
            >
              {t('boards.save')}
            </Button>
          </div>
        </div>
      ) : (
        <LinkedText text={entry.body ?? ''} className="text-sm" />
      )}
      {isComment && editing === null && (canEdit || canDelete) ? (
        <div className="flex flex-wrap gap-1">
          {canEdit ? (
            <Button type="button" variant="ghost" className="h-11 px-2 text-xs" onClick={onEdit}>
              {t('boards.editComment')}
            </Button>
          ) : null}
          {canDelete ? (
            <Button type="button" variant="ghost" className="h-11 px-2 text-xs" onClick={onDelete}>
              {t('boards.deleteComment')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
