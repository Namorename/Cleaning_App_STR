import {
  BOARD_LIMITS,
  CARD_COLOR_NAMES,
  CARD_ORDERS,
  DUE_FILTERS,
  EMPTY_CARD_FILTERS,
  type CardFilters,
  type CardOrder,
  type ColorFilter,
  type DueFilter,
} from '@str-ops/shared';
import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { ChoiceChips } from '@/components/choice-chips';
import { ListRow } from '@/components/list-row';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

import { useCardColor } from './format';
import type { Board, BoardViewer, OfficePerson } from './schema';
import { useSaveBoard } from './use-boards';

const DUE_LABEL: Record<DueFilter, string> = {
  all: 'boards.filters.dueAll',
  overdue: 'boards.filters.overdue',
  today: 'boards.filters.today',
  week: 'boards.filters.week',
  none: 'boards.filters.none',
};

interface FiltersSheetProps {
  isVisible: boolean;
  onClose: () => void;
  filters: CardFilters;
  onChange: (next: CardFilters) => void;
  order: CardOrder;
  onOrderChange: (next: CardOrder) => void;
  /** Who a card can be given to: the assignee filter. Absent, no such filter. */
  people?: readonly OfficePerson[];
  /** The viewer: «Назначено мне», first among the people. */
  viewerId?: string;
}

/** The board's filters and order: due date, colours, unticked steps, the assignee; «Сбросить». */
export function FiltersSheet({
  isVisible,
  onClose,
  filters,
  onChange,
  order,
  onOrderChange,
  people,
  viewerId,
}: FiltersSheetProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const toggleColor = (color: ColorFilter) =>
    onChange({
      ...filters,
      colors: filters.colors.includes(color)
        ? filters.colors.filter((one) => one !== color)
        : [...filters.colors, color],
    });

  return (
    <BottomSheet isVisible={isVisible} title={t('boards.filters.label')} onClose={onClose}>
      <View style={styles.sheet}>
        <Text variant="chip" tone="secondary">
          {t('boards.filters.due')}
        </Text>
        <ChoiceChips
          options={DUE_FILTERS.map((due) => ({ value: due, label: t(DUE_LABEL[due]) }))}
          value={filters.due}
          onChange={(due) => onChange({ ...filters, due })}
          accessibilityLabel={t('boards.filters.due')}
          semantics="radio"
        />
        <Text variant="chip" tone="secondary">
          {t('boards.filters.color')}
        </Text>
        <View style={styles.swatches}>
          {(['none', ...CARD_COLOR_NAMES] as const).map((color) => (
            <ColorToggle
              key={color}
              color={color}
              isOn={filters.colors.includes(color)}
              onPress={() => toggleColor(color)}
            />
          ))}
        </View>
        <ChoiceChips
          options={[
            { value: 'all', label: t('boards.filters.dueAll') },
            { value: 'open', label: t('boards.filters.openSteps') },
          ]}
          value={filters.openSteps ? 'open' : 'all'}
          onChange={(value) => onChange({ ...filters, openSteps: value === 'open' })}
          accessibilityLabel={t('boards.filters.openSteps')}
          semantics="radio"
        />
        {people === undefined ? null : (
          <>
            <Text variant="chip" tone="secondary">
              {t('boards.filters.assignee')}
            </Text>
            <ChoiceChips
              options={[
                { value: 'all', label: t('boards.filters.assigneeAll') },
                ...(viewerId === undefined
                  ? []
                  : [{ value: viewerId, label: t('boards.assignedToMe') }]),
                { value: 'none', label: t('boards.noAssignee') },
                ...people
                  .filter((person) => person.id !== viewerId)
                  .map((person) => ({
                    value: person.id,
                    label: person.full_name ?? t('boards.unknownPerson'),
                  })),
              ]}
              value={filters.assignee}
              onChange={(assignee: string) => onChange({ ...filters, assignee })}
              accessibilityLabel={t('boards.filters.assignee')}
              semantics="radio"
            />
          </>
        )}
        <Text variant="chip" tone="secondary">
          {t('boards.order.label')}
        </Text>
        <ChoiceChips
          options={CARD_ORDERS.map((one) => ({ value: one, label: t(`boards.order.${one}`) }))}
          value={order}
          onChange={onOrderChange}
          accessibilityLabel={t('boards.order.label')}
          semantics="radio"
        />
        <Button
          label={t('boards.filters.reset')}
          variant="outline"
          onPress={() => onChange({ ...EMPTY_CARD_FILTERS, query: filters.query })}
        />
      </View>
    </BottomSheet>
  );
}

/** One colour of the filter: a named swatch the finger can hit, ticked when it narrows the board. */
function ColorToggle({
  color,
  isOn,
  onPress,
}: {
  color: ColorFilter;
  isOn: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const values = useCardColor(color === 'none' ? null : color);
  const name = color === 'none' ? t('boards.noColor') : t(`boards.colors.${color}`);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isOn }}
      accessibilityLabel={name}
      onPress={onPress}
      style={[styles.toggle, isOn && styles.toggleOn]}
    >
      <View
        style={[
          styles.swatch,
          values === null ? styles.noSwatch : { backgroundColor: values.stripe },
        ]}
      />
    </Pressable>
  );
}

interface BoardNameSheetProps {
  isVisible: boolean;
  /** The board to change; absent, a new board. */
  board?: Pick<Board, 'id' | 'title' | 'shared' | 'owner_id'>;
  /** Who changes it: an admin changing another's board reads «Видна только владельцу». */
  viewer?: BoardViewer;
  onClose: () => void;
  onSaved: (boardId: string) => void;
}

type Visibility = 'private' | 'shared';

/**
 * «Новая доска» and «Настройки доски»: the name, who sees the board (20261126120000) — a new one its
 * maker alone unless she says otherwise — and the button. A new board's id is minted once per
 * opening: a repeat after a lost answer is the same board.
 */
export function BoardNameSheet({
  isVisible,
  board,
  viewer,
  onClose,
  onSaved,
}: BoardNameSheetProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const save = useSaveBoard();
  const [boardId, setBoardId] = useState(() => board?.id ?? newId());
  const [title, setTitle] = useState(board?.title ?? '');
  const [visibility, setVisibility] = useState<Visibility>(
    board?.shared === true ? 'shared' : 'private',
  );
  const failure = save.isError ? serverErrorText(save.error) : null;
  const isOthers = board !== undefined && viewer !== undefined && board.owner_id !== viewer.id;

  const close = () => {
    if (save.isPending) {
      return;
    }
    save.reset();
    if (board !== undefined) {
      // Closed unsaved: the next opening shows the board as it is, not the words left here.
      setTitle(board.title);
      setVisibility(board.shared ? 'shared' : 'private');
    }
    onClose();
  };

  const submit = () => {
    if (title.trim() === '' || save.isPending) {
      return;
    }
    save.mutate(
      { boardId, title, shared: visibility === 'shared' },
      {
        onSuccess: () => {
          onSaved(boardId);
          if (board === undefined) {
            setBoardId(newId());
            setTitle('');
            setVisibility('private');
          }
        },
      },
    );
  };

  return (
    <BottomSheet
      isVisible={isVisible}
      title={board === undefined ? t('boards.newBoard') : t('boards.settingsTitle')}
      onClose={close}
    >
      <View style={styles.sheet}>
        <TextField
          label={t('boards.boardName')}
          value={title}
          onChangeText={setTitle}
          maxLength={BOARD_LIMITS.boardTitle}
          placeholder={t('boards.boardNamePlaceholder')}
          onSubmitEditing={submit}
          error={failure?.text ?? null}
        />
        <Text variant="chip" tone="secondary">
          {t('boards.visibility')}
        </Text>
        <ChoiceChips
          options={[
            {
              value: 'private' as const,
              label: isOthers ? t('boards.visibilityPrivateOwner') : t('boards.visibilityPrivate'),
            },
            { value: 'shared' as const, label: t('boards.visibilityShared') },
          ]}
          value={visibility}
          onChange={setVisibility}
          accessibilityLabel={t('boards.visibility')}
          semantics="radio"
        />
        <Text variant="caption" tone="secondary">
          {t('boards.visibilityNote')}
        </Text>
        <Text variant="caption" tone="secondary">
          {t('boards.boardRightsNote')}
        </Text>
        <Button
          label={board === undefined ? t('boards.create') : t('boards.save')}
          onPress={submit}
          isDisabled={title.trim() === ''}
          isBusy={save.isPending}
        />
      </View>
    </BottomSheet>
  );
}

interface ArchivedBoardsSheetProps {
  isVisible: boolean;
  boards: readonly Board[];
  onClose: () => void;
  onChoose: (boardId: string) => void;
}

/** The archived boards, each opening read-only with «Вернуть доску». */
export function ArchivedBoardsSheet({
  isVisible,
  boards,
  onClose,
  onChoose,
}: ArchivedBoardsSheetProps) {
  const { t } = useTranslation();
  return (
    <BottomSheet isVisible={isVisible} title={t('boards.archivedBoards')} onClose={onClose}>
      {boards.length === 0 ? (
        <Text tone="secondary">{t('boards.archivedBoardsEmpty')}</Text>
      ) : (
        boards.map((board) => (
          <ListRow key={board.id} title={board.title} onPress={() => onChoose(board.id)} />
        ))
      )}
    </BottomSheet>
  );
}

interface ActionsSheetProps {
  isVisible: boolean;
  title: string;
  actions: readonly { label: string; onPress: () => void; isDestructive?: boolean }[];
  onClose: () => void;
}

/** A short list of actions for one thing — a board, a step, a comment. */
export function ActionsSheet({ isVisible, title, actions, onClose }: ActionsSheetProps) {
  const styles = useThemedStyles(createStyles);
  return (
    <BottomSheet isVisible={isVisible} title={title} onClose={onClose}>
      <View style={styles.sheet}>
        {actions.map((action) => (
          <Button
            key={action.label}
            label={action.label}
            variant={action.isDestructive === true ? 'destructive' : 'outline'}
            onPress={() => {
              onClose();
              action.onPress();
            }}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

function newId(): string {
  return randomUUID();
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    sheet: { gap: Spacing.md },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
    toggle: {
      width: MIN_TOUCH_TARGET,
      height: MIN_TOUCH_TARGET,
      borderRadius: Radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
    },
    toggleOn: { borderWidth: 3, borderColor: theme.text },
    swatch: { width: 26, height: 26, borderRadius: Radius.pill },
    noSwatch: { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.textSecondary },
  });
