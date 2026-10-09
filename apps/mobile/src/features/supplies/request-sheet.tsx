import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { Spacing } from '@/constants/theme';

import { withLine } from './cart';
import { CartRowView } from './cart-row';
import { PriorityChips } from './priority-chips';
import {
  filledItems,
  MAX_SUPPLY_ITEM_COMMENT,
  MAX_SUPPLY_NOTE,
  type SupplyDraft,
  type SupplyItemDraft,
} from './schema';

/** What a stepper does to a line in the request, wherever the line is drawn. */
export interface LineActions {
  step: (line: SupplyItemDraft, delta: 1 | -1) => void;
  type: (line: SupplyItemDraft, text: string) => void;
  /** She left its number: an empty field or a zero takes it out. */
  leave: (line: SupplyItemDraft) => void;
}

interface RequestSheetProps {
  isVisible: boolean;
  onClose: () => void;
  draft: SupplyDraft;
  onChange: (draft: SupplyDraft) => void;
  actions: LineActions;
  isDisabled: boolean;
}

/**
 * The whole request, opened from the summary under the list: the chosen lines
 * with their quantities and each line's comment (the old «уточнение»), the
 * urgency explained in words, and the note — everything the old long form
 * could send, nothing more. A long request scrolls inside the sheet.
 */
export function RequestSheet({
  isVisible,
  onClose,
  draft,
  onChange,
  actions,
  isDisabled,
}: RequestSheetProps) {
  const { t } = useTranslation();
  const lines = filledItems(draft);

  return (
    <BottomSheet
      testID="supply-request-sheet"
      isVisible={isVisible}
      title={t('supplies.summaryTitle')}
      onClose={onClose}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {lines.length === 0 ? <Text tone="secondary">{t('supplies.cartEmpty')}</Text> : null}
        {lines.map((line) => (
          <View key={line.key} style={styles.line}>
            <View style={styles.row}>
              <CartRowView
                title={line.name}
                unit={t(`supplies.units.${line.unit}`)}
                value={line.quantity}
                isInRequest
                isDisabled={isDisabled}
                onStep={(delta) => actions.step(line, delta)}
                onChangeText={(text) => actions.type(line, text)}
                onBlur={() => actions.leave(line)}
              />
            </View>
            <TextField
              label={t('supplies.itemCommentLabel')}
              accessibilityLabel={t('supplies.itemCommentAccessibility', { name: line.name })}
              placeholder={t('supplies.itemCommentPlaceholder')}
              maxLength={MAX_SUPPLY_ITEM_COMMENT}
              isDisabled={isDisabled}
              value={line.comment}
              onChangeText={(comment) => onChange(withLine(draft, { ...line, comment }))}
            />
          </View>
        ))}

        <View style={styles.field}>
          <Text tone="secondary">{t('supplies.priorityLabel')}</Text>
          <PriorityChips
            value={draft.priority}
            onChange={(priority) => onChange({ ...draft, priority })}
            isDisabled={isDisabled}
          />
          <Text variant="caption" tone="secondary">
            {t('supplies.priorityHint')}
          </Text>
        </View>

        <TextField
          label={t('supplies.noteLabel')}
          placeholder={t('supplies.notePlaceholder')}
          maxLength={MAX_SUPPLY_NOTE}
          multiline
          isDisabled={isDisabled}
          value={draft.note}
          onChangeText={(note) => onChange({ ...draft, note })}
        />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // Takes what the sheet has left and scrolls the rest; never more than it
  // needs. Edge to edge of the sheet, so the rows can be: a scroll view clips
  // what reaches past it.
  scroll: { flexGrow: 0, flexShrink: 1, marginHorizontal: -Spacing.lg },
  content: { gap: Spacing.lg, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  line: { gap: Spacing.xs },
  // A row like a row of the list; its words line up with the sheet's title.
  row: { marginHorizontal: -Spacing.lg },
  field: { gap: Spacing.xs },
});
