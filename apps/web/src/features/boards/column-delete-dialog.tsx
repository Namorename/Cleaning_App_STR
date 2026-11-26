'use client';

import { columnName, moveTargets } from '@str-ops/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { serverErrorHint, serverErrorParams, serverErrorText } from '@/lib/server-error';

import type { PresetName } from './lanes';
import type { ColumnRow } from './schema';
import { useDeleteColumn } from './use-boards';

interface ColumnDeleteDialogProps {
  column: ColumnRow;
  /** The board's live columns: where its cards may go. */
  live: readonly ColumnRow[];
  /** The cards it holds — archived and deleted ones too — as the panel read them. */
  cardCount: number;
  presetName: PresetName;
  onClose: () => void;
  onDeleted: () => void;
}

/** The count of cards the server says the column holds, when it refused for them. */
function heldByServer(error: unknown): number {
  if (serverErrorHint(error) !== 'serverErrors.boardColumnHasCards') {
    return 0;
  }
  const count = Number(serverErrorParams(error).count);
  return Number.isFinite(count) ? count : 0;
}

/**
 * «Удалить колонку?» (20261126120000). A column without cards goes at a press; one holding cards —
 * archived and deleted ones counted too, as the server counts them — asks where they go, and each
 * gets a «moved» line in its journal. Cards the panel had not read yet are counted by the server's
 * refusal, and the question is asked then.
 */
export function ColumnDeleteDialog({
  column,
  live,
  cardCount,
  presetName,
  onClose,
  onDeleted,
}: ColumnDeleteDialogProps) {
  const { t } = useTranslation();
  const remove = useDeleteColumn();
  const selectId = useId();
  const [targetId, setTargetId] = useState('');
  // What the server said the column holds: kept, so a retry still asks where the cards go.
  const [serverHeld, setServerHeld] = useState(0);
  const targets = moveTargets(live, column.id);
  const held = Math.max(cardCount, serverHeld);
  const needsTarget = held > 0;
  const isTargetChosen = targets.some((target) => target.id === targetId);
  const failure = remove.isError ? serverErrorText(remove.error) : null;
  const name = columnName(column, presetName);

  const close = () => {
    if (!remove.isPending) {
      onClose();
    }
  };
  const confirm = () => {
    if (remove.isPending || (needsTarget && !isTargetChosen)) {
      return;
    }
    remove.mutate(
      { columnId: column.id, moveToId: needsTarget ? targetId : null },
      {
        onSuccess: onDeleted,
        onError: (error: unknown) => setServerHeld((now) => Math.max(now, heldByServer(error))),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="break-words">
            {t('boards.columnDeleteTitle', { name })}
          </DialogTitle>
          <DialogDescription>
            {needsTarget
              ? t('boards.columnDeleteCards', { count: held })
              : t('boards.columnDeleteEmpty')}
          </DialogDescription>
        </DialogHeader>
        {needsTarget ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={selectId}>{t('boards.columnMoveTarget')}</Label>
            <NativeSelect
              id={selectId}
              required
              value={targetId}
              className="h-11"
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="" disabled>
                {t('boards.columnMoveTargetPick')}
              </option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {columnName(target, presetName)}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        {failure === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {failure.text}
            {failure.detail === null ? null : (
              <span className="block text-xs text-muted-foreground">{failure.detail}</span>
            )}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={close}>
            {t('boards.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11"
            disabled={remove.isPending || (needsTarget && !isTargetChosen)}
            onClick={confirm}
          >
            {t('boards.columnDelete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
