import {
  BOARD_COLUMN_LIMITS,
  canAddColumn,
  columnOrderAfterStep,
  liveColumns,
  moveTargets,
} from '@str-ops/shared';
import { randomUUID } from 'expo-crypto';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { ChoiceChips } from '@/components/choice-chips';
import { FailureText } from '@/components/failure-text';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorKey, serverErrorText } from '@/lib/server-error';

import { columnIdOf, columnLabel } from './columns';
import type { Board, BoardCard, ColumnRow } from './schema';
import { useDeleteColumn, useOrderColumns, useSaveColumn, useSetColumnDone } from './use-boards';

/** The refusal of a delete that named no column for the cards the server found in it. */
const HAS_CARDS = 'serverErrors.boardColumnHasCards';

interface ColumnsSheetProps {
  isVisible: boolean;
  board: Pick<Board, 'id' | 'title'>;
  /** The board's columns as read, the deleted ones too. */
  columns: readonly ColumnRow[];
  /** The board's cards, archived and deleted ones too: what a column holds. */
  cards: readonly BoardCard[];
  onClose: () => void;
}

/**
 * «Колонки» of a board (20261126120000), its owner's and an admin's: each live column in order — a
 * tap opens its rename, «Выше» / «Ниже», the «Завершающая» switch and its delete — and a new one at
 * the end. A delete asks first, there, in the same sheet: what the column holds, and where its
 * cards go when it holds any.
 */
export function ColumnsSheet({ isVisible, board, columns, cards, onClose }: ColumnsSheetProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const order = useOrderColumns();
  const setDone = useSetColumnDone();
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ColumnRow | null>(null);
  const live = liveColumns(columns);
  const failed = [order, setDone].find((mutation) => mutation.isError);
  const isBusy = order.isPending || setDone.isPending;

  const close = () => {
    order.reset();
    setDone.reset();
    setDeleting(null);
    onClose();
  };

  return (
    <BottomSheet
      isVisible={isVisible}
      title={t('boards.columnsTitle', { title: board.title })}
      onClose={close}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        {deleting !== null ? (
          <DeleteColumn
            column={deleting}
            columns={columns}
            cards={cards}
            onDone={() => setDeleting(null)}
          />
        ) : (
          <>
            {live.map((column, index) => (
              <ColumnEditor
                key={column.id}
                column={column}
                isOpen={openId === column.id}
                onToggle={() => setOpenId((now) => (now === column.id ? null : column.id))}
                canUp={index > 0}
                canDown={index < live.length - 1}
                canDelete={live.length > 1}
                isBusy={isBusy}
                onStep={(step) =>
                  order.mutate({
                    boardId: board.id,
                    columnIds: columnOrderAfterStep(columns, column.id, step),
                  })
                }
                onToggleDone={() => setDone.mutate({ columnId: column.id, done: !column.is_done })}
                onDelete={() => setDeleting(column)}
              />
            ))}
            {failed === undefined ? null : <FailureText error={failed.error} />}
            <AddColumn boardId={board.id} isFull={!canAddColumn(columns)} />
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

interface ColumnEditorProps {
  column: ColumnRow;
  isOpen: boolean;
  onToggle: () => void;
  canUp: boolean;
  canDown: boolean;
  /** Not the board's last live column. */
  canDelete: boolean;
  /** An order or a switch on its way: the next waits for it. */
  isBusy: boolean;
  onStep: (step: -1 | 1) => void;
  onToggleDone: () => void;
  onDelete: () => void;
}

/** One column: its name, and once opened what is done with it. */
function ColumnEditor({
  column,
  isOpen,
  onToggle,
  canUp,
  canDown,
  canDelete,
  isBusy,
  onStep,
  onToggleDone,
  onDelete,
}: ColumnEditorProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const name = columnLabel(column, t);
  return (
    <View style={styles.column}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={column.is_done ? `${name}. ${t('boards.columnDone')}` : name}
        accessibilityState={{ expanded: isOpen }}
        onPress={onToggle}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        <Text variant="title">{name}</Text>
        {column.is_done ? (
          <Text variant="caption" tone="secondary">
            {t('boards.columnDone')}
          </Text>
        ) : null}
      </Pressable>
      {isOpen ? (
        <View style={styles.controls}>
          <RenameColumn column={column} name={name} />
          <View style={styles.pair}>
            <Button
              label={t('boards.columnUp')}
              variant="outline"
              isDisabled={!canUp || isBusy}
              onPress={() => onStep(-1)}
              style={styles.half}
            />
            <Button
              label={t('boards.columnDown')}
              variant="outline"
              isDisabled={!canDown || isBusy}
              onPress={() => onStep(1)}
              style={styles.half}
            />
          </View>
          <DoneSwitch isOn={column.is_done} isDisabled={isBusy} onPress={onToggleDone} />
          <Text variant="caption" tone="secondary">
            {t('boards.columnDoneHint')}
          </Text>
          {canDelete ? (
            <Button label={t('boards.columnDelete')} variant="destructive" onPress={onDelete} />
          ) : (
            <Text tone="secondary">{t('boards.columnLast')}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

/** «Завершающая»: the whole row is the switch, as on the settings screen. */
function DoneSwitch({
  isOn,
  isDisabled,
  onPress,
}: {
  isOn: boolean;
  isDisabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={t('boards.columnDone')}
      accessibilityState={{ checked: isOn, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={styles.switchRow}
    >
      <Text style={styles.switchText}>{t('boards.columnDone')}</Text>
      <Switch
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        value={isOn}
        disabled={isDisabled}
        onValueChange={onPress}
        trackColor={{ true: theme.primary }}
      />
    </Pressable>
  );
}

/**
 * The column's name, changed. A preset column keeps no name of its own until one is typed: saved
 * unchanged, it stays the word each person reads in their language.
 */
function RenameColumn({ column, name }: { column: ColumnRow; name: string }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const save = useSaveColumn();
  // Null: not being renamed.
  const [title, setTitle] = useState<string | null>(null);

  if (title === null) {
    return (
      <Button
        label={t('boards.columnRename')}
        variant="outline"
        onPress={() => setTitle(column.title ?? name)}
      />
    );
  }

  const stop = () => {
    save.reset();
    setTitle(null);
  };
  const submit = () => {
    const words = title.trim();
    if (words === '' || save.isPending) {
      return;
    }
    if (words === (column.title ?? name)) {
      stop();
      return;
    }
    save.mutate({ columnId: column.id, boardId: null, title: words }, { onSuccess: stop });
  };

  return (
    <View style={styles.controls}>
      <TextField
        label={t('boards.columnRename')}
        value={title}
        onChangeText={setTitle}
        maxLength={BOARD_COLUMN_LIMITS.title}
        onSubmitEditing={submit}
        error={save.isError ? serverErrorText(save.error).text : null}
      />
      <Button
        label={t('boards.save')}
        onPress={submit}
        isDisabled={title.trim() === ''}
        isBusy={save.isPending}
      />
      <Button label={t('boards.cancel')} variant="outline" onPress={stop} />
    </View>
  );
}

/** A new column at the end: up to twelve live ones. */
function AddColumn({ boardId, isFull }: { boardId: string; isFull: boolean }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const save = useSaveColumn();
  const [title, setTitle] = useState('');
  // One id per attempt — the same words: a repeat after a lost answer is the same column, and
  // other words are a new column, not an answer of the old one.
  const attempt = useRef<{ key: string; columnId: string } | null>(null);

  if (isFull) {
    return (
      <Text tone="secondary">{t('boards.columnsMax', { max: BOARD_COLUMN_LIMITS.columns })}</Text>
    );
  }

  const submit = () => {
    const words = title.trim();
    if (words === '' || save.isPending) {
      return;
    }
    const columnId = attempt.current?.key === words ? attempt.current.columnId : randomUUID();
    attempt.current = { key: words, columnId };
    save.mutate(
      { columnId, boardId, title: words },
      {
        onSuccess: () => {
          setTitle((now) => (now.trim() === words ? '' : now));
          attempt.current = null;
        },
      },
    );
  };

  return (
    <View style={styles.controls}>
      <TextField
        label={t('boards.columnName')}
        value={title}
        onChangeText={setTitle}
        maxLength={BOARD_COLUMN_LIMITS.title}
        returnKeyType="done"
        onSubmitEditing={submit}
        isDisabled={save.isPending}
        error={save.isError ? serverErrorText(save.error).text : null}
      />
      <Button
        label={t('boards.columnAdd')}
        onPress={submit}
        isDisabled={title.trim() === ''}
        isBusy={save.isPending}
      />
    </View>
  );
}

interface DeleteColumnProps {
  column: ColumnRow;
  columns: readonly ColumnRow[];
  cards: readonly BoardCard[];
  onDone: () => void;
}

/**
 * «Удалить колонку «…»?»: what it holds — its cards on the board, in the archive and deleted — and,
 * when it holds any, the column they move to, without which nothing is sent. The phone counts the
 * cards it read; the server counts them all, and a refusal that found some asks for the column too.
 */
function DeleteColumn({ column, columns, cards, onDone }: DeleteColumnProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const remove = useDeleteColumn();
  const [target, setTarget] = useState<string | null>(null);
  const live = liveColumns(columns);
  const name = columnLabel(column, t);
  const count = cards.filter((card) => columnIdOf(card, live) === column.id).length;
  const needsTarget = count > 0 || serverErrorKey(remove.error) === HAS_CARDS;
  const isBlocked = needsTarget && target === null;

  const submit = () => {
    if (remove.isPending || isBlocked) {
      return;
    }
    remove.mutate(
      { columnId: column.id, moveTo: needsTarget ? target : null },
      { onSuccess: onDone },
    );
  };

  return (
    <View style={styles.controls}>
      <Text variant="title" accessibilityRole="header">
        {t('boards.columnDeleteTitle', { name })}
      </Text>
      {count > 0 ? (
        <Text>{t('boards.columnDeleteCards', { count })}</Text>
      ) : needsTarget ? null : (
        <Text>{t('boards.columnDeleteEmpty')}</Text>
      )}
      {needsTarget ? (
        <>
          <Text variant="chip" tone="secondary">
            {t('boards.columnMoveTarget')}
          </Text>
          <ChoiceChips
            options={moveTargets(columns, column.id).map((one) => ({
              value: one.id,
              label: columnLabel(one, t),
            }))}
            value={target ?? ''}
            onChange={setTarget}
            accessibilityLabel={t('boards.columnMoveTarget')}
            semantics="radio"
          />
        </>
      ) : null}
      {remove.isError ? <FailureText error={remove.error} /> : null}
      <Button
        label={t('boards.columnDelete')}
        variant="destructive"
        onPress={submit}
        isDisabled={isBlocked}
        isBusy={remove.isPending}
      />
      <Button
        label={t('boards.cancel')}
        variant="outline"
        isDisabled={remove.isPending}
        onPress={() => {
          remove.reset();
          onDone();
        }}
      />
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    body: { gap: Spacing.md, paddingBottom: Spacing.md },
    column: {
      gap: Spacing.sm,
      padding: Spacing.sm,
      borderRadius: Radius.card,
      backgroundColor: theme.surfaceAlt,
    },
    head: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', gap: Spacing.xs },
    pressed: { opacity: 0.7 },
    controls: { gap: Spacing.sm },
    pair: { flexDirection: 'row', gap: Spacing.sm },
    half: { flex: 1 },
    switchRow: {
      minHeight: MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
    },
    switchText: { flex: 1 },
  });
