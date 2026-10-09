import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { ChoiceChips } from '@/components/choice-chips';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { Text } from '@/components/text';
import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { problemStatusText } from '@/features/problems/format';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { i18n } from '@/i18n';

import { personName } from './format';
import {
  ANY_ASSIGNEE,
  BOARD_STATUS_FILTERS,
  NO_ASSIGNEE,
  type AssigneeFilter,
  type BoardStatusFilter,
  type StaffMember,
} from './schema';

/** A status chip's word: the task statuses' own, «Все» and «Архив» beside them. */
function statusFilterText(filter: BoardStatusFilter): string {
  switch (filter) {
    case 'all':
      return i18n.t('problems.board.all');
    case 'archived':
      return i18n.t('problems.board.archive');
    default:
      return problemStatusText(filter);
  }
}

/** Who the assignee filter is set to, in words. */
export function assigneeFilterText(
  filter: AssigneeFilter,
  names: ReadonlyMap<string, string>,
): string {
  switch (filter.kind) {
    case 'all':
      return i18n.t('problems.board.assigneeAll');
    case 'nobody':
      return i18n.t('problems.board.nobody');
    case 'person':
      return personName(names, filter.id);
  }
}

function isSameFilter(a: AssigneeFilter, b: AssigneeFilter): boolean {
  return a.kind === b.kind && (a.kind !== 'person' || (b.kind === 'person' && a.id === b.id));
}

interface BoardFiltersProps {
  status: BoardStatusFilter;
  onStatusChange: (status: BoardStatusFilter) => void;
  assignee: AssigneeFilter;
  names: ReadonlyMap<string, string>;
  onPickAssignee: () => void;
}

/** The two filters above the board: the status as a row of chips, the person behind a button. */
export function BoardFilters({
  status,
  onStatusChange,
  assignee,
  names,
  onPickAssignee,
}: BoardFiltersProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  // Six words, read again on each draw: they follow the language.
  const options = BOARD_STATUS_FILTERS.map((value) => ({ value, label: statusFilterText(value) }));
  const label = t('problems.board.assigneeButton', {
    name: assigneeFilterText(assignee, names),
  });

  return (
    <View style={styles.filters}>
      <ChoiceChips
        options={options}
        value={status}
        onChange={onStatusChange}
        accessibilityLabel={t('problems.board.statusFilter')}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPickAssignee}
        style={({ pressed }) => [styles.picker, pressed && styles.pressed]}
      >
        <Text style={styles.pickerText}>{label}</Text>
        <Icon name="action.expand" size="small" tone="secondary" />
      </Pressable>
    </View>
  );
}

interface AssigneeSheetProps {
  isVisible: boolean;
  value: AssigneeFilter;
  technicians: readonly StaffMember[];
  names: ReadonlyMap<string, string>;
  onChange: (filter: AssigneeFilter) => void;
  onClose: () => void;
}

/** Everybody, nobody, or one of the active technicians — the head technician too. */
export function AssigneeSheet({
  isVisible,
  value,
  technicians,
  names,
  onChange,
  onClose,
}: AssigneeSheetProps) {
  const { t } = useTranslation();
  const choices: readonly AssigneeFilter[] = [
    ANY_ASSIGNEE,
    NO_ASSIGNEE,
    ...technicians.map((person) => ({ kind: 'person' as const, id: person.id })),
  ];

  return (
    <BottomSheet
      testID="board-assignee-sheet"
      isVisible={isVisible}
      title={t('problems.board.assigneeFilter')}
      onClose={onClose}
    >
      <ScrollView>
        {choices.map((choice) => {
          const isSelected = isSameFilter(choice, value);
          return (
            <ListRow
              key={choice.kind === 'person' ? choice.id : choice.kind}
              title={assigneeFilterText(choice, names)}
              isSelected={isSelected}
              right={isSelected ? <Icon name="status.done" tone="primary" /> : undefined}
              onPress={() => onChange(choice)}
            />
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    filters: { gap: Spacing.xs, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
    picker: {
      alignSelf: 'flex-start',
      minHeight: MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.lg,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.card,
    },
    pickerText: { flexShrink: 1 },
    pressed: { backgroundColor: theme.surfaceAlt },
  });
