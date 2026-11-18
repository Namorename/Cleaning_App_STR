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
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { ChoiceChips } from '@/components/choice-chips';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorBanner } from '@/components/error-banner';
import { ErrorState } from '@/components/error-state';
import { FailureText } from '@/components/failure-text';
import { LoadingState } from '@/components/loading-state';
import { MonthGrid } from '@/components/month-grid';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { Radius, Spacing, type Theme } from '@/constants/theme';
import { PropertyPicker } from '@/features/properties/property-picker';
import { useStaffDirectory } from '@/features/board/use-board';
import { useReportProperties } from '@/features/properties/use-properties';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { monthOf } from '@/lib/calendar-month';
import { serverErrorText } from '@/lib/server-error';

import type { CardFields } from './api';
import { ActionsSheet } from './board-sheets';
import { CardJournalList, CardStepsList, ColorChoice, LinkedText } from './card-parts';
import { formatDue, formatStamp, useCardColor } from './format';
import {
  assignablePeople,
  canWorkOn,
  cardPlace,
  shelfOf,
  type CardDetail,
  type CardShelf,
} from './schema';
import {
  useBoards,
  useCard,
  useDuplicateCard,
  useMoveCard,
  useSaveCard,
  useSetCardAssignee,
  useSetCardShelf,
  useViewer,
} from './use-boards';

/**
 * A manager board's card on the phone: the column as buttons, the assignee, the fields (links
 * open), the steps, the actions and the journal. Every manager and admin changes all of it on a
 * live board (20261119090000); a comment is changed by its author. Nothing on screen explains who
 * may do what. A shelved card is read until «Вернуть».
 */
export function CardScreen({ cardId }: { cardId: string }) {
  const { t } = useTranslation();
  const card = useCard(cardId);
  const boards = useBoards();

  const retry = () => {
    void card.refetch();
    void boards.refetch();
  };
  // Only a card never read shows the failure: one read before stays on screen under a banner.
  if (card.data === undefined || boards.data === undefined) {
    return card.isError || boards.isError ? (
      <ErrorState
        error={card.error ?? boards.error}
        title={t('boards.cardLoadError')}
        onRetry={retry}
      />
    ) : (
      <LoadingState label={t('boards.cardLoading')} />
    );
  }
  if (card.data === null) {
    return <ErrorState error={null} title={t('boards.cardGone')} />;
  }
  const board = boards.data.find((one) => one.id === card.data?.board_id) ?? null;
  return (
    <>
      {card.isError || boards.isError ? (
        <ErrorBanner title={t('boards.staleNote')} error={card.error ?? boards.error} />
      ) : null}
      <CardBody card={card.data} canWork={board !== null && canWorkOn(board)} />
    </>
  );
}

function CardBody({ card, canWork }: { card: CardDetail; canWork: boolean }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const viewer = useViewer();
  const move = useMoveCard(card.board_id);
  const shelve = useSetCardShelf();
  const duplicate = useDuplicateCard();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [dismissedDone, setDismissedDone] = useState(false);
  const color = useCardColor(card.color);
  const shelf = shelfOf(card);
  const canEdit = canWork && shelf === 'active';
  const lastColumn = t(`problems.statuses.${LAST_BOARD_COLUMN}`);
  const offersDone =
    canEdit &&
    !dismissedDone &&
    card.column_key !== LAST_BOARD_COLUMN &&
    isEveryStepDone(card.steps);
  const failed = [move, shelve, duplicate].find((mutation) => mutation.isError);
  const pendingCopy = useRef<string | null>(null);

  const putOn = (next: CardShelf) =>
    shelve.mutate(
      { cardId: card.id, shelf: next },
      { onSuccess: () => (next === 'active' ? undefined : router.back()) },
    );
  const copy = () => {
    if (duplicate.isPending) {
      return;
    }
    // One copy per attempt: a repeat after a lost answer is the same copy, not a second one.
    const copyId = pendingCopy.current ?? randomUUID();
    pendingCopy.current = copyId;
    const title = t('boards.copyTitle', { title: card.title }).slice(0, BOARD_LIMITS.cardTitle);
    duplicate.mutate(
      { sourceId: card.id, cardId: copyId, title },
      {
        onSuccess: () => {
          pendingCopy.current = null;
          router.replace({ pathname: '/board-card/[id]', params: { id: copyId } });
        },
      },
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
      // The comment and the new step sit at the bottom: the keyboard must not cover them (iOS).
      automaticallyAdjustKeyboardInsets
    >
      {color === null ? null : (
        <View
          style={[styles.stripe, { backgroundColor: color.stripe }]}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        />
      )}
      <Text variant="heading">{card.title}</Text>
      <Text variant="caption" tone="secondary">
        {t('boards.created', {
          when: formatStamp(card.created_at),
          name: card.creator?.full_name ?? t('boards.unknownPerson'),
        })}
      </Text>

      {shelf === 'active' ? null : (
        <View style={styles.note}>
          <Text>{shelf === 'deleted' ? t('boards.cardDeleted') : t('boards.cardArchived')}</Text>
          {canWork ? (
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
            value={card.column_key as BoardColumn}
            onChange={(column: BoardColumn) => move.mutate({ cardId: card.id, column })}
            accessibilityLabel={t('boards.moveTo')}
            semantics="radio"
          />
        ) : (
          <Text>{t(`problems.statuses.${card.column_key}`)}</Text>
        )}
      </View>

      <AssigneeSection card={card} canAssign={canEdit} />

      {isEditing && canEdit ? (
        <EditFields card={card} onDone={() => setIsEditing(false)} />
      ) : (
        <ReadFields card={card} onEdit={canEdit ? () => setIsEditing(true) : undefined} />
      )}

      <CardStepsList card={card} canEdit={canEdit} />

      {canEdit ? (
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
      {failed === undefined ? null : <FailureText error={failed.error} />}

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

/**
 * Who works on the card. The board's owner and an admin pick from the company's active managers
 * and admins, or «Без исполнителя» (one push goes to the new assignee); anybody else reads it.
 */
function AssigneeSection({ card, canAssign }: { card: CardDetail; canAssign: boolean }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const staff = useStaffDirectory();
  const assign = useSetCardAssignee();
  const [isPicking, setIsPicking] = useState(false);
  const name =
    card.assignee_id === null
      ? t('boards.noAssignee')
      : (card.assignee?.full_name ?? t('boards.unknownPerson'));
  const choose = (assigneeId: string | null) => {
    setIsPicking(false);
    if (assigneeId !== card.assignee_id && !assign.isPending) {
      assign.mutate({ cardId: card.id, assigneeId });
    }
  };

  return (
    <View style={styles.section}>
      <Text variant="chip" tone="secondary">
        {t('boards.assignee')}
      </Text>
      {canAssign ? (
        <Button
          label={name}
          accessibilityLabel={`${t('boards.assignee')}: ${name}`}
          variant="outline"
          isBusy={assign.isPending}
          // Not before the directory is read: an empty sheet would offer only «Без исполнителя».
          isDisabled={staff.data === undefined}
          onPress={() => setIsPicking(true)}
        />
      ) : (
        <Text>{name}</Text>
      )}
      {assign.isError ? <FailureText error={assign.error} /> : null}
      <ActionsSheet
        isVisible={isPicking}
        title={t('boards.assignee')}
        onClose={() => setIsPicking(false)}
        actions={[
          ...assignablePeople(staff.data ?? []).map((person) => ({
            label: person.full_name ?? t('boards.unknownPerson'),
            onPress: () => choose(person.id),
          })),
          { label: t('boards.noAssignee'), onPress: () => choose(null) },
        ]}
      />
    </View>
  );
}

function ReadFields({ card, onEdit }: { card: CardDetail; onEdit?: () => void }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
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
      {onEdit === undefined ? null : (
        <Button label={t('boards.edit')} variant="outline" onPress={onEdit} />
      )}
    </View>
  );
}

function EditFields({ card, onDone }: { card: CardDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const save = useSaveCard();
  const properties = useReportProperties();
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [dueOn, setDueOn] = useState<string | null>(card.due_on);
  // The month the grid shows: the due date's, or this one.
  const [month, setMonth] = useState(() => monthOf(card.due_on ?? localDay()));
  const [propertyId, setPropertyId] = useState<number | null>(card.property_id);
  const [color, setColor] = useState<CardColor | null>(isCardColor(card.color) ? card.color : null);
  const failure = save.isError ? serverErrorText(save.error).text : null;

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
        {t('boards.due')}: {dueOn === null ? t('boards.noDue') : formatDue(dueOn)}
      </Text>
      <MonthGrid
        month={month}
        selectedDay={dueOn}
        onSelectDay={setDueOn}
        onMonthChange={setMonth}
        testID="card-due"
      />
      {dueOn === null ? null : (
        <Button label={t('boards.clearDue')} variant="outline" onPress={() => setDueOn(null)} />
      )}
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
    stripe: { height: 6, borderRadius: Radius.pill },
  });
