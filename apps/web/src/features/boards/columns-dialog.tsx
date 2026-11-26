'use client';

import {
  BOARD_COLUMN_LIMITS,
  canAddColumn,
  canDeleteColumn,
  columnName,
  columnOrderAfterDrop,
  columnOrderAfterStep,
  liveColumns,
} from '@str-ops/shared';
import { Plus } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { serverErrorText, type ServerErrorText } from '@/lib/server-error';

import { ColumnDeleteDialog } from './column-delete-dialog';
import { ColumnListItem } from './column-list-item';
import type { PresetName } from './lanes';
import type { Board, BoardCard, ColumnRow } from './schema';
import { useOrderColumns, useSaveColumn, useSetColumnDone } from './use-boards';

interface ColumnsDialogProps {
  board: Pick<Board, 'id' | 'title'>;
  /** The board's columns, the deleted ones too. */
  columns: readonly ColumnRow[];
  /** Every card of the board — on it, archived and deleted: what a column's cards are counted by. */
  cards: readonly Pick<BoardCard, 'column_id'>[];
  onClose: () => void;
}

/**
 * «Колонки» (20261126120000): the board's live columns in their order, for its owner and an admin —
 * renamed in place, marked finishing, moved up and down by a button or dragged, deleted (never the
 * last; one holding cards with a column for them), and one more added at the end, up to twelve.
 * Every change goes to the server at once; a new order shows before it answers.
 */
export function ColumnsDialog({ board, columns, cards, onClose }: ColumnsDialogProps) {
  const { t } = useTranslation();
  const presetName: PresetName = (key) => t(`problems.statuses.${key}`);
  const hintId = useId();
  const live = liveColumns(columns, board.id);
  const order = useOrderColumns();
  const rename = useSaveColumn();
  const setDone = useSetColumnDone(board.id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ColumnRow | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // The latest failure only: an older one never outlives a later success.
  const [failure, setFailure] = useState<ServerErrorText | null>(null);
  const outcome = (onSuccess?: () => void) => ({
    onSuccess: () => {
      setFailure(null);
      onSuccess?.();
    },
    onError: (error: unknown) => setFailure(serverErrorText(error)),
  });
  const mayDelete = canDeleteColumn(live);

  // One order at a time: the next is counted from the order the last one made.
  const reorder = (ids: readonly string[]) => {
    const isSame = ids.every((id, index) => id === live[index]?.id);
    if (isSame || order.isPending) {
      return;
    }
    order.mutate({ boardId: board.id, columnIds: ids }, outcome());
  };
  const saveName = (column: ColumnRow, title: string) => {
    const words = title.trim();
    setEditingId(null);
    if (words === '' || words === columnName(column, presetName)) {
      return;
    }
    rename.mutate({ columnId: column.id, boardId: null, title: words }, outcome());
  };
  const endDrag = () => {
    setDragging(null);
    setOverId(null);
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-words">
            {t('boards.columnsTitle', { title: board.title })}
          </DialogTitle>
          <DialogDescription>{t('boards.columnDragHint')}</DialogDescription>
        </DialogHeader>
        <p id={hintId} className="text-xs text-muted-foreground">
          {t('boards.columnDoneHint')}
        </p>
        <ol className="flex flex-col gap-1">
          {live.map((column, index) => (
            <ColumnListItem
              key={column.id}
              column={column}
              name={columnName(column, presetName)}
              doneHintId={hintId}
              isFirst={index === 0}
              isLast={index === live.length - 1}
              mayDelete={mayDelete}
              isEditing={editingId === column.id}
              isDragging={dragging === column.id}
              isOver={dragging !== null && dragging !== column.id && overId === column.id}
              onEdit={() => setEditingId(column.id)}
              onEditSave={(title) => saveName(column, title)}
              onEditCancel={() => setEditingId(null)}
              onDone={(done) => setDone.mutate({ columnId: column.id, done }, outcome())}
              onStep={(step) => reorder(columnOrderAfterStep(live, column.id, step))}
              onDelete={() => setDeleting(column)}
              drag={{
                onDragStart: () => setDragging(column.id),
                onDragOver: () => {
                  if (dragging !== null && dragging !== column.id) {
                    setOverId(column.id);
                    return true;
                  }
                  return false;
                },
                onDragLeave: () => setOverId((now) => (now === column.id ? null : now)),
                onDrop: () => {
                  if (dragging !== null) {
                    reorder(columnOrderAfterDrop(live, dragging, column.id));
                  }
                  endDrag();
                },
                onDragEnd: endDrag,
              }}
            />
          ))}
        </ol>
        {mayDelete ? null : (
          <p className="text-sm text-muted-foreground">{t('boards.columnLast')}</p>
        )}
        {failure === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {failure.text}
            {failure.detail === null ? null : (
              <span className="block text-xs text-muted-foreground">{failure.detail}</span>
            )}
          </p>
        )}
        <AddColumn boardId={board.id} canAdd={canAddColumn(live)} />
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" className="h-11" />}>
            {t('panel.close')}
          </DialogClose>
        </DialogFooter>
        {deleting === null ? null : (
          <ColumnDeleteDialog
            column={deleting}
            live={live}
            cardCount={cards.filter((card) => card.column_id === deleting.id).length}
            presetName={presetName}
            onClose={() => setDeleting(null)}
            onDeleted={() => {
              setFailure(null);
              setDeleting(null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A column added at the end of the board: its name, Enter or «Добавить колонку». Its id is minted
 * per name: a repeat after a lost answer is the same column. At twelve the field rests, saying so.
 */
function AddColumn({ boardId, canAdd }: { boardId: string; canAdd: boolean }) {
  const { t } = useTranslation();
  const save = useSaveColumn();
  const inputId = useId();
  const [title, setTitle] = useState('');
  const [columnId, setColumnId] = useState(() => crypto.randomUUID());
  const failure = save.isError ? serverErrorText(save.error) : null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const words = title.trim();
    if (!canAdd || words === '' || save.isPending) {
      return;
    }
    save.mutate(
      { columnId, boardId, title: words },
      {
        onSuccess: () => {
          setTitle((now) => (now.trim() === words ? '' : now));
          setColumnId(crypto.randomUUID());
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1 border-t pt-4">
      <Label htmlFor={inputId}>{t('boards.columnName')}</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={inputId}
          value={title}
          maxLength={BOARD_COLUMN_LIMITS.title}
          disabled={!canAdd}
          aria-busy={save.isPending}
          onChange={(event) => setTitle(event.target.value)}
          className="h-11 min-w-0 flex-1"
        />
        <Button
          type="submit"
          className="h-11"
          disabled={!canAdd || save.isPending || title.trim() === ''}
        >
          <Plus aria-hidden="true" />
          {t('boards.columnAdd')}
        </Button>
      </div>
      {canAdd ? null : (
        <p className="text-sm text-muted-foreground">
          {t('boards.columnsMax', { max: BOARD_COLUMN_LIMITS.columns })}
        </p>
      )}
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
          {failure.detail === null ? null : (
            <span className="block text-xs text-muted-foreground">{failure.detail}</span>
          )}
        </p>
      )}
    </form>
  );
}
