import {
  BOARD_COLUMNS,
  BOARD_LIMITS,
  dueState,
  isCardColor,
  isEveryStepDone,
  LAST_BOARD_COLUMN,
  localDay,
  type BoardColumn,
  type CardColor,
} from '@str-ops/shared';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { ChoiceChips } from '@/components/choice-chips';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { Radius, Spacing, type Theme } from '@/constants/theme';
import { PropertyPicker } from '@/features/properties/property-picker';
import { useReportProperties } from '@/features/properties/use-properties';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

import type { CardFields } from './api';
import { CardJournalList, CardStepsList, ColorChoice, LinkedText } from './card-parts';
import { formatDue, formatStamp, useCardColor } from './format';
import { canEditBoard, cardPlace, shelfOf, type CardDetail, type CardShelf } from './schema';
import {
  useBoards,
  useCard,
  useDuplicateCard,
  useMoveCard,
  useSaveCard,
  useSetCardShelf,
  useViewer,
} from './use-boards';

/**
 * A manager board's card on the phone: the column as buttons, the fields
 * (links open), the steps, the actions and the journal. Its owner and an
 * admin change it; another manager reads it. A shelved card is read until
 * «Вернуть».
 */
export function CardScreen({ cardId }: { cardId: string }) {
  const { t } = useTranslation();
  const card = useCard(cardId);
  const boards = useBoards();
  const viewer = useViewer();

  if (card.isPending || boards.isPending) {
    return <LoadingState label={t('boards.cardLoading')} />;
  }
  if (card.isError || boards.isError) {
    return (
      <ErrorState
        error={card.error ?? boards.error}
        title={t('boards.cardLoadError')}
        onRetry={() => void card.refetch()}
      />
    );
  }
  if (card.data === null) {
    return <ErrorState error={null} title={t('boards.cardGone')} />;
  }
  const board = boards.data.find((one) => one.id === card.data?.board_id) ?? null;
  return (
    <CardBody card={card.data} boardEditable={board !== null && canEditBoard(board, viewer)} />
  );
}

function CardBody({ card, boardEditable }: { card: CardDetail; boardEditable: boolean }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const viewer = useViewer();
  const move = useMoveCard(card.board_id);
  const shelve = useSetCardShelf();
  const duplicate = useDuplicateCard();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [dismissedDone, setDismissedDone] = useState(false);
  const shelf = shelfOf(card);
  const canEdit = boardEditable && shelf === 'active';
  const lastColumn = t(`problems.statuses.${LAST_BOARD_COLUMN}`);
  const offersDone =
    canEdit &&
    !dismissedDone &&
    card.column_key !== LAST_BOARD_COLUMN &&
    isEveryStepDone(card.steps);
  const failed = [move, shelve, duplicate].find((mutation) => mutation.isError);

  const putOn = (next: CardShelf) =>
    shelve.mutate(
      { cardId: card.id, shelf: next },
      { onSuccess: () => (next === 'active' ? undefined : router.back()) },
    );
  const copy = () => {
    const copyId = randomUUID();
    const title = t('boards.copyTitle', { title: card.title }).slice(0, BOARD_LIMITS.cardTitle);
    duplicate.mutate(
      { sourceId: card.id, cardId: copyId, title },
      { onSuccess: () => router.replace({ pathname: '/board-card/[id]', params: { id: copyId } }) },
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text variant="heading">{card.title}</Text>
      <Text variant="caption" tone="secondary">
        {t('boards.created', {
          when: formatStamp(card.created_at),
          name: card.creator?.full_name ?? t('boards.unknownPerson'),
        })}
      </Text>

      {shelf === 'active' ? null : (
        <View style={styles.note}>
          <Text>{t('boards.shelvedNote')}</Text>
          {boardEditable ? (
            <Button
              label={t('boards.restoreCard')}
              isBusy={shelve.isPending}
              onPress={() => putOn('active')}
            />
          ) : null}
        </View>
      )}

      {offersDone ? (
        <View style={styles.offer} accessibilityLiveRegion="polite">
          <Text>{t('boards.allStepsDone', { column: lastColumn })}</Text>
          <Button
            label={t('boards.moveIt')}
            isBusy={move.isPending}
            onPress={() => move.mutate({ cardId: card.id, column: LAST_BOARD_COLUMN })}
          />
          <Button
            label={t('boards.notNow')}
            variant="outline"
            onPress={() => setDismissedDone(true)}
          />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text variant="chip" tone="secondary">
          {t('boards.column')}
        </Text>
        {canEdit ? (
          <ChoiceChips
            options={BOARD_COLUMNS.map((column) => ({
              value: column,
              label: t(`problems.statuses.${column}`),
            }))}
            value={card.column_key}
            onChange={(column: BoardColumn) => move.mutate({ cardId: card.id, column })}
            accessibilityLabel={t('boards.moveTo')}
            semantics="radio"
          />
        ) : (
          <Text>{t(`problems.statuses.${card.column_key}`)}</Text>
        )}
      </View>

      {isEditing && canEdit ? (
        <EditFields card={card} onDone={() => setIsEditing(false)} />
      ) : (
        <ReadFields card={card} onEdit={canEdit ? () => setIsEditing(true) : undefined} />
      )}

      <CardStepsList card={card} canEdit={canEdit} />

      {boardEditable && shelf === 'active' ? (
        <View style={styles.section}>
          <Button
            label={t('boards.duplicate')}
            variant="outline"
            isBusy={duplicate.isPending}
            onPress={copy}
          />
          <Button
            label={t('boards.archiveCard')}
            variant="outline"
            isBusy={shelve.isPending}
            onPress={() => putOn('archived')}
          />
          <Button
            label={t('boards.deleteCard')}
            variant="destructive"
            onPress={() => setIsDeleting(true)}
          />
        </View>
      ) : null}
      {failed === undefined ? null : (
        <Text tone="danger">{serverErrorText(failed.error).text}</Text>
      )}

      <CardJournalList card={card} viewer={viewer} canEdit={canEdit} />

      <ConfirmDialog
        isVisible={isDeleting}
        title={t('boards.deleteCardTitle')}
        message={t('boards.deleteCardText', { title: card.title })}
        confirmLabel={t('boards.deleteCard')}
        cancelLabel={t('boards.cancel')}
        variant="destructive"
        onConfirm={() => {
          setIsDeleting(false);
          putOn('deleted');
        }}
        onCancel={() => setIsDeleting(false)}
      />
    </ScrollView>
  );
}

function ReadFields({ card, onEdit }: { card: CardDetail; onEdit?: () => void }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const color = useCardColor(card.color);
  const place = cardPlace(card);
  const state = dueState(card.due_on, localDay(), card.column_key);
  return (
    <View style={styles.section}>
      {card.description.trim() === '' ? (
        <Text tone="secondary">{t('boards.noDescription')}</Text>
      ) : (
        <LinkedText text={card.description} />
      )}
      <View style={styles.fact}>
        <Text tone="secondary">{t('boards.due')}</Text>
        {card.due_on === null ? (
          <Text>{t('boards.noDue')}</Text>
        ) : state === 'overdue' || state === 'today' ? (
          <Badge
            label={
              state === 'overdue'
                ? t('boards.dueChip.overdue', { day: formatDue(card.due_on) })
                : t('boards.dueChip.today')
            }
            tone={state === 'overdue' ? 'overdue' : 'today'}
          />
        ) : (
          <Text>{formatDue(card.due_on)}</Text>
        )}
      </View>
      <View style={styles.fact}>
        <Text tone="secondary">{t('boards.property')}</Text>
        <Text style={styles.factValue}>{place ?? t('boards.noProperty')}</Text>
      </View>
      <View style={styles.fact}>
        <Text tone="secondary">{t('boards.color')}</Text>
        {color === null ? null : <View style={[styles.dot, { backgroundColor: color.stripe }]} />}
        <Text>
          {isCardColor(card.color) ? t(`boards.colors.${card.color}`) : t('boards.noColor')}
        </Text>
      </View>
      {onEdit === undefined ? null : (
        <Button label={t('boards.edit')} variant="outline" onPress={onEdit} />
      )}
    </View>
  );
}

/** The days a due date is picked from on the phone: none, today, and the days after it. */
const DUE_OFFSETS = [0, 1, 2, 3, 7, 14] as const;

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function EditFields({ card, onDone }: { card: CardDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const save = useSaveCard();
  const properties = useReportProperties();
  const today = localDay();
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [dueOn, setDueOn] = useState<string | null>(card.due_on);
  const [propertyId, setPropertyId] = useState<number | null>(card.property_id);
  const [color, setColor] = useState<CardColor | null>(isCardColor(card.color) ? card.color : null);
  const failure = save.isError ? serverErrorText(save.error).text : null;

  const days = DUE_OFFSETS.map((offset) => addDays(today, offset));
  const dueOptions = [
    { value: 'none', label: t('boards.noDue') },
    ...(dueOn !== null && !days.includes(dueOn) ? [{ value: dueOn, label: formatDue(dueOn) }] : []),
    ...days.map((day) => ({ value: day, label: formatDue(day) })),
  ];

  const submit = () => {
    if (title.trim() === '' || save.isPending) {
      return;
    }
    const fields: CardFields = { title, description, dueOn, propertyId, color };
    save.mutate({ cardId: card.id, boardId: card.board_id, fields }, { onSuccess: onDone });
  };

  return (
    <View style={styles.section}>
      <TextField
        label={t('boards.cardTitle')}
        value={title}
        onChangeText={setTitle}
        maxLength={BOARD_LIMITS.cardTitle}
      />
      <TextField
        label={t('boards.description')}
        value={description}
        onChangeText={setDescription}
        maxLength={BOARD_LIMITS.description}
        placeholder={t('boards.descriptionPlaceholder')}
        multiline
      />
      <Text variant="chip" tone="secondary">
        {t('boards.due')}
      </Text>
      <ChoiceChips
        options={dueOptions}
        value={dueOn ?? 'none'}
        onChange={(value) => setDueOn(value === 'none' ? null : value)}
        accessibilityLabel={t('boards.due')}
        semantics="radio"
      />
      <PropertyPicker
        properties={properties.data ?? []}
        selectedId={propertyId}
        onSelect={setPropertyId}
        isLoading={properties.isPending}
      />
      {propertyId === null ? null : (
        <Button
          label={t('boards.noProperty')}
          variant="outline"
          onPress={() => setPropertyId(null)}
        />
      )}
      <Text variant="chip" tone="secondary">
        {t('boards.color')}
      </Text>
      <ColorChoice value={color} onChange={setColor} />
      {failure === null ? null : <Text tone="danger">{failure}</Text>}
      <Button
        label={t('boards.save')}
        isBusy={save.isPending}
        isDisabled={title.trim() === ''}
        onPress={submit}
      />
      <Button label={t('boards.cancel')} variant="outline" onPress={onDone} />
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { padding: Spacing.md, gap: Spacing.lg, backgroundColor: theme.background },
    section: { gap: Spacing.sm },
    note: {
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: Radius.card,
      backgroundColor: theme.surfaceAlt,
    },
    offer: {
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: Radius.card,
      backgroundColor: theme.surfaceAlt,
      borderWidth: 1,
      borderColor: theme.primary,
    },
    fact: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
    factValue: { flex: 1 },
    dot: { width: 14, height: 14, borderRadius: Radius.pill },
  });
