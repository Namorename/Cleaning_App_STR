import { HeaderHeightContext } from 'expo-router/react-navigation';
import { use, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, View } from 'react-native';

import { ActionBar } from '@/components/action-bar';
import { useKeyboardOffset } from '@/components/bottom-inset';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { MIN_TOUCH_TARGET, ROW_HEIGHT, Spacing, type Theme } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

import {
  cartRows,
  catalogLine,
  isZeroQuantity,
  stepQuantity,
  withLine,
  withoutLine,
  withQuantity,
  type CartRow,
} from './cart';
import { CartRowView } from './cart-row';
import { LineSheet, type LineEditor } from './line-sheet';
import { PriorityChips } from './priority-chips';
import { RequestSheet, type LineActions } from './request-sheet';
import {
  catalogItemName,
  filledItems,
  newItemDraft,
  supplyDraftIssue,
  type CatalogItem,
  type SupplyDraft,
  type SupplyItemDraft,
} from './schema';

interface SupplyFormProps {
  draft: SupplyDraft;
  onChange: (draft: SupplyDraft) => void;
  /** The key of a new line; the route's, so the form stays pure. */
  newKey: () => string;
  /** Where the supplies are for, when known; the form does not let her change it. */
  place: string | null;
  /** The company's list; empty means she types every name. */
  catalog: readonly CatalogItem[];
  isSubmitting: boolean;
  submitLabel: string;
  onSubmit: () => void;
  /** The last attempt's failure, said next to the button so she can retry. */
  error: Error | null;
}

function rowKey(row: CartRow): string {
  return row.kind === 'line' ? `line:${row.line.key}` : `entry:${row.entry.id}`;
}

/**
 * What she needs, as a cart (owner's variant 1, docs/design/decisions.md §2).
 *
 * The catalogue is the form: a search on top, then every entry with a stepper
 * — a tap is one more, the number can be typed — and manual entry as the last
 * row. A summary pinned under the list counts the lines, switches the urgency
 * and sends; a tap on it opens the whole request with each line's comment and
 * the note. A request of five lines is five taps, not five forms.
 *
 * Presentational: the route owns the draft and what is sent. The button stays
 * grey under the rule it always had, mirroring the server's refusals.
 */
export function SupplyForm({
  draft,
  onChange,
  newKey,
  place,
  catalog,
  isSubmitting,
  submitLabel,
  onSubmit,
  error,
}: SupplyFormProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const language = useLanguage();
  // The keyboard's top is measured from the window's, the form's from under
  // the header: the header's height is the difference. Outside a navigator
  // (a test) there is no header. Less the inset the action bar rises by
  // (components/bottom-inset.ts).
  const keyboardOffset = useKeyboardOffset(use(HeaderHeightContext) ?? 0);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<LineEditor | null>(null);
  const [isLineSheetOpen, setLineSheetOpen] = useState(false);
  const [isRequestOpen, setRequestOpen] = useState(false);

  const issue = supplyDraftIssue(draft);
  const failure = error === null ? null : serverErrorText(error);
  const count = t('supplies.itemCount', { count: filledItems(draft).length });
  const rows = cartRows(draft, catalog, query);

  // A line that carries her words — a comment, or a name the catalogue does
  // not have — asks before it leaves: a step to zero took them with it, with
  // no way back (the review of 05.10). «Отмена» keeps it, at one if it fell to
  // zero; a tap beside the question is «Отмена» too.
  const remove = (line: SupplyItemDraft) => {
    const leaveIt = () => onChange(withoutLine(draft, line.key));
    if (line.comment.trim() === '' && line.catalogItemId !== null) {
      leaveIt();
      return;
    }
    const keep = () => {
      if (isZeroQuantity(line.quantity)) {
        onChange(withQuantity(draft, line.key, '1'));
      }
    };
    Alert.alert(
      t('supplies.removeLineTitle', { name: line.name }),
      t('supplies.removeLineBody'),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: keep },
        { text: t('supplies.removeLine'), style: 'destructive', onPress: leaveIt },
      ],
      { cancelable: true, onDismiss: keep },
    );
  };

  const actions: LineActions = {
    step: (line, delta) => {
      const next = stepQuantity(line.quantity, delta);
      if (next === null) {
        remove(line);
      } else {
        onChange(withQuantity(draft, line.key, next));
      }
    },
    type: (line, text) => onChange(withQuantity(draft, line.key, text)),
    leave: (line) => {
      if (isZeroQuantity(line.quantity)) {
        remove(line);
      }
    },
  };

  // A row at zero has no line yet: a step up or a typed number starts one.
  // Anything typed does, a lone "0" too — she may be on her way to "0,5";
  // leaving the field at zero takes it out again.
  const addEntry = (entry: CatalogItem, quantity: string) =>
    onChange(withLine(draft, catalogLine(newKey(), entry, language, quantity)));

  const stepEntry = (entry: CatalogItem, line: SupplyItemDraft | null, delta: 1 | -1) => {
    if (line !== null) {
      actions.step(line, delta);
    } else if (delta === 1) {
      addEntry(entry, '1');
    }
  };

  const typeEntry = (entry: CatalogItem, line: SupplyItemDraft | null, text: string) => {
    if (line !== null) {
      actions.type(line, text);
    } else if (text.trim() !== '') {
      addEntry(entry, text);
    }
  };

  const openLine = (line: SupplyItemDraft, isNew: boolean) => {
    setEditor({ id: (editor?.id ?? 0) + 1, line, isNew });
    setLineSheetOpen(true);
  };

  // What she searched for and did not find is the likely name.
  const openNewLine = () => openLine({ ...newItemDraft(newKey()), name: query.trim() }, true);

  const confirmLine = (line: SupplyItemDraft) => {
    onChange(withLine(draft, line));
    setLineSheetOpen(false);
  };

  const renderRow = ({ item }: { item: CartRow }) => {
    if (item.kind === 'line') {
      const { line } = item;
      return (
        <CartRowView
          title={line.name}
          unit={t(`supplies.units.${line.unit}`)}
          value={line.quantity}
          isInRequest
          isDisabled={isSubmitting}
          onStep={(delta) => actions.step(line, delta)}
          onChangeText={(text) => actions.type(line, text)}
          onBlur={() => actions.leave(line)}
          onEdit={line.catalogItemId === null ? () => openLine(line, false) : undefined}
        />
      );
    }
    const { entry, line } = item;
    return (
      <CartRowView
        title={catalogItemName(entry, language)}
        unit={t(`supplies.units.${entry.unit}`)}
        value={line?.quantity ?? '0'}
        isInRequest={line !== null}
        isDisabled={isSubmitting}
        onStep={(delta) => stepEntry(entry, line, delta)}
        onChangeText={(text) => typeEntry(entry, line, text)}
        onBlur={() => {
          if (line !== null) {
            actions.leave(line);
          }
        }}
      />
    );
  };

  const header = (
    <View style={styles.header}>
      {place !== null ? <Text tone="secondary">{place}</Text> : null}
      {catalog.length > 0 ? (
        <TextField
          label={t('supplies.searchCatalog')}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : null}
    </View>
  );

  const footer = (
    <>
      {rows.length === 0 && query.trim() !== '' ? (
        <Text tone="secondary" style={styles.noMatch}>
          {t('supplies.catalogNoMatch')}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={catalog.length > 0 ? t('supplies.manualEntry') : t('supplies.addItem')}
        disabled={isSubmitting}
        onPress={openNewLine}
        style={({ pressed }) => [styles.manual, pressed && styles.pressed]}
      >
        <Text tone="primary" weight={700}>
          {catalog.length > 0 ? t('supplies.manualEntry') : t('supplies.addItem')}
        </Text>
      </Pressable>
    </>
  );

  return (
    // Padding on both systems, as the report form does: the view measures how
    // much of it the keyboard covers, and with Android drawing edge to edge
    // the system does not make room for it.
    <KeyboardAvoidingView
      style={styles.screen}
      behavior="padding"
      keyboardVerticalOffset={keyboardOffset}
    >
      <FlatList
        style={styles.screen}
        data={rows}
        keyExtractor={rowKey}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        keyboardShouldPersistTaps="handled"
      />

      {/* Under the list rather than over it: the last row scrolls up to its
          edge, and a summary grown by a large system font lifts the list
          instead of covering more of it (components/action-bar.tsx). */}
      <ActionBar isAtScreenEdge testID="supply-form-actions">
        <View style={styles.summary}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={count}
            accessibilityHint={t('supplies.showRequest')}
            onPress={() => setRequestOpen(true)}
            style={({ pressed }) => [styles.count, pressed && styles.pressed]}
          >
            <Text weight={700}>{count}</Text>
            <Text variant="caption" tone="primary">
              {t('supplies.showRequest')}
            </Text>
          </Pressable>
          <PriorityChips
            value={draft.priority}
            onChange={(priority) => onChange({ ...draft, priority })}
            isDisabled={isSubmitting}
          />
        </View>
        {issue === 'itemInvalid' ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {t('supplies.itemInvalidHint')}
          </Text>
        ) : null}
        {failure !== null ? (
          <View accessibilityLiveRegion="polite" style={styles.failure}>
            <Text tone="danger" align="center">
              {failure.text}
            </Text>
            {failure.detail !== null ? (
              // The server's words, for passing on; a long one must not push
              // the button off the screen.
              <Text variant="caption" tone="secondary" align="center" numberOfLines={3}>
                {failure.detail}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Button
          label={submitLabel}
          onPress={onSubmit}
          isDisabled={issue !== null}
          isBusy={isSubmitting}
        />
      </ActionBar>

      <LineSheet
        isVisible={isLineSheetOpen}
        editor={editor}
        onConfirm={confirmLine}
        onClose={() => setLineSheetOpen(false)}
      />
      <RequestSheet
        isVisible={isRequestOpen}
        onClose={() => setRequestOpen(false)}
        draft={draft}
        onChange={onChange}
        actions={actions}
        isDisabled={isSubmitting}
      />
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    header: { padding: Spacing.lg, gap: Spacing.md },
    noMatch: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
    manual: {
      minHeight: ROW_HEIGHT,
      justifyContent: 'center',
      paddingHorizontal: Spacing.lg,
    },
    pressed: { opacity: 0.6 },
    summary: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    count: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', flexShrink: 1 },
    failure: { gap: Spacing.xs },
  });
