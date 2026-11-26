'use client';

import { BOARD_COLUMN_LIMITS } from '@str-ops/shared';
import { ArrowDown, ArrowUp, GripVertical, Pencil, Trash2 } from 'lucide-react';
import {
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { ColumnRow } from './schema';
import type { RowControl } from './use-column-order';

/** What the list does while a column is dragged over its rows. */
export interface ColumnDragHandlers {
  onDragStart: () => void;
  /** Whether the column dragged may be dropped on this row: the browser is told so then. */
  onDragOver: () => boolean;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

interface ColumnListItemProps {
  column: ColumnRow;
  /** Its name in the reader's language. */
  name: string;
  /** The sentence that says what «Завершающая» means, said once above the list. */
  doneHintId: string;
  isFirst: boolean;
  isLast: boolean;
  /** Not the board's last live column. */
  mayDelete: boolean;
  isEditing: boolean;
  isDragging: boolean;
  /** The column dragged is over this row and lands in its place when let go. */
  isOver: boolean;
  onEdit: () => void;
  /** The new name; `byKey` when Enter saved it (the focus goes back to «Переименовать»). */
  onEditSave: (title: string, byKey: boolean) => void;
  onEditCancel: () => void;
  onDone: (done: boolean) => void;
  onStep: (step: -1 | 1) => void;
  onDelete: () => void;
  drag: ColumnDragHandlers;
  ref?: Ref<HTMLLIElement>;
}

/**
 * One column in «Колонки»: dragged by the row, renamed in place, finishing or not, moved up and
 * down by buttons — the keyboard's way to order — and deleted. The row and each of its controls
 * name the column, so a screen reader tells them apart from the other rows'.
 */
export function ColumnListItem({
  column,
  name,
  doneHintId,
  isFirst,
  isLast,
  mayDelete,
  isEditing,
  isDragging,
  isOver,
  onEdit,
  onEditSave,
  onEditCancel,
  onDone,
  onStep,
  onDelete,
  drag,
  ref,
}: ColumnListItemProps) {
  const { t } = useTranslation();
  // Every control names the column it acts on: «Выше: Ждём ответа».
  const named = (label: string) => `${label}: ${name}`;

  const handleDragStart = (event: DragEvent<HTMLLIElement>) => {
    // Firefox starts a drag only when something is set.
    event.dataTransfer?.setData('text/plain', column.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    drag.onDragStart();
  };
  const handleDragOver = (event: DragEvent<HTMLLIElement>) => {
    if (!drag.onDragOver()) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  };
  const handleDrop = (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    drag.onDrop();
  };

  return (
    <li
      ref={ref}
      aria-label={name}
      draggable={!isEditing}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={drag.onDragLeave}
      onDrop={handleDrop}
      onDragEnd={drag.onDragEnd}
      className={cn(
        'flex flex-wrap items-center gap-1 rounded-lg border bg-card py-1 pr-1 pl-2',
        !isEditing && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50',
        isOver && 'bg-accent outline-2 outline-offset-2 outline-primary outline-solid',
      )}
    >
      <GripVertical aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      {isEditing ? (
        <NameField name={name} onSave={onEditSave} onCancel={onEditCancel} />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>
            {name}
          </span>
          <IconButton control="rename" label={named(t('boards.columnRename'))} onClick={onEdit}>
            <Pencil aria-hidden="true" />
          </IconButton>
        </>
      )}
      <label className="flex min-h-11 cursor-pointer items-center gap-2 px-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={column.is_done}
          aria-label={named(t('boards.columnDone'))}
          aria-describedby={doneHintId}
          onChange={(event) => onDone(event.target.checked)}
        />
        {t('boards.columnDone')}
      </label>
      <div role="group" aria-label={t('boards.columnMove', { name })} className="flex">
        <IconButton
          control="up"
          label={named(t('boards.columnUp'))}
          disabled={isFirst}
          onClick={() => onStep(-1)}
        >
          <ArrowUp aria-hidden="true" />
        </IconButton>
        <IconButton
          control="down"
          label={named(t('boards.columnDown'))}
          disabled={isLast}
          onClick={() => onStep(1)}
        >
          <ArrowDown aria-hidden="true" />
        </IconButton>
      </div>
      <IconButton label={named(t('boards.columnDelete'))} disabled={!mayDelete} onClick={onDelete}>
        <Trash2 aria-hidden="true" />
      </IconButton>
    </li>
  );
}

/**
 * The column's name being changed: Enter or leaving the field saves, Escape keeps the old one — and
 * keeps the dialog open.
 */
function NameField({
  name,
  onSave,
  onCancel,
}: {
  name: string;
  onSave: (title: string, byKey: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(name);
  // Enter and Escape settle the change themselves: the blur that follows them is not a save.
  const isSettled = useRef(false);

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      isSettled.current = true;
      onSave(value, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      isSettled.current = true;
      onCancel();
    }
  };
  const blur = () => {
    if (!isSettled.current) {
      onSave(value, false);
    }
  };

  return (
    <Input
      autoFocus
      value={value}
      maxLength={BOARD_COLUMN_LIMITS.title}
      aria-label={t('boards.columnName')}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={keys}
      onBlur={blur}
      className="h-11 min-w-0 flex-1"
    />
  );
}

function IconButton({
  control,
  label,
  disabled = false,
  onClick,
  children,
}: {
  /** The control the focus is kept on through a change of the list. */
  control?: RowControl;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="size-11"
      data-control={control}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
