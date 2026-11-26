import {
  BOARD_LIMITS,
  dueState,
  firstDoneColumn,
  isCardColor,
  isEveryStepDone,
  isInDoneColumn,
  liveColumns,
  localDay,
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
import { columnIdOf, columnLabel } from './columns';
import { formatDue, formatStamp, useCardColor } from './format';
import {
  assignablePeople,
  cardAccess,
  cardPlace,
  shelfOf,
  type CardAccess,
  type CardDetail,
  type CardShelf,
  type ColumnRow,
} from './schema';
import {
  useBoardColumns,
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
 * A manager board's card on the phone: its board's columns as buttons, the assignee, the fields
 * (links open), the steps, the actions and the journal. Every manager and admin changes all of it
 * on a live board (20261119090000); a comment is changed by its author. A card given to her on a
 * board she does not see (20261126120000) she works on — fields, column, steps, comments — and no
 * more. Nothing on screen explains who may do what. A shelved card is read until «Вернуть».
 */
export function CardScreen({ cardId }: { cardId: string }) {
  const { t } = useTranslation();
  const card = useCard(cardId);
  const boards = useBoards();
  const viewer = useViewer();

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
  // A board missing from her list is one she does not see: the card is given to her on it.
  const board = boards.data.find((one) => one.id === card.data?.board_id) ?? null;
  return (
    <>
      {card.isError || boards.isError ? (
        <ErrorBanner title={t('boards.staleNote')} error={card.error ?? boards.error} />
      ) : null}
      <CardBody card={card.data} access={cardAccess(card.data, board, viewer)} />
    </>
  );
}

function CardBody({ card, access }: { card: CardDetail; access: CardAccess }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const viewer = useViewer();
  const columns = useBoardColumns(card.board_id);
  const move = useMoveCard(card.board_id);
  const shelve = useSetCardShelf();
  const duplicate = useDuplicateCard();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [dismissedDone, setDismissedDone] = useState(false);
  const color = useCardColor(card.color);
  const shelf = shelfOf(card);
  const canEdit = access.canWork && shelf === 'active';
  const canManage = access.canManage && shelf === 'active';
  const everyColumn = columns.data ?? [];
  const live = liveColumns(everyColumn);
  const currentId = columnIdOf(card, live);
  const current = live.find((column) => column.id === currentId) ?? null;
  const isDone = current?.is_done ?? isInDoneColumn(card);
  // Where a card with every step ticked is offered to go: the board's first finishing column —
  // none on a board without one, nor for a card already done.
  const offered =
    canEdit && !dismissedDone && !isDone && isEveryStepDone(card.steps)
      ? firstDoneColumn(live)
      : null;
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
          {access.canManage ? (
            <Button
              label={t('boards.restoreCard')}
              isBusy={shelve.isPending}
              onPress={() => putOn('active')}
            />
          ) : null}
        </View>
      )}

      {offered !== null ? (
        <View style={styles.offer} accessibilityLiveRegion="polite">
          <Text>{t('boards.allStepsDone', { column: columnLabel(offered, t) })}</Text>
          <Button
            label={t('boards.moveIt')}
            isBusy={move.isPending}
            onPress={() => move.mutate({ cardId: card.id, column: offered })}
          />
          <Button
            label={t('boards.notNow')}
            variant="outline"
            onPress={() => setDismissedDone(true)}
          />
        </View>
      ) : null}

      <ColumnSection
        current={current}
        columns={canEdit ? live : []}
        fallbackKey={card.column_key}
        onMove={(column) => move.mutate({ cardId: card.id, column })}
      />

      <AssigneeSection card={card} canAssign={canManage} />

      {isEditing && canEdit ? (
        <EditFields card={card} onDone={() => setIsEditing(false)} />
      ) : (
        <ReadFields card={card} onEdit={canEdit ? () => setIsEditing(true) : undefined} />
      )}

      <CardStepsList card={card} canEdit={canEdit} />

      {canManage ? (
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

      <CardJournalList card={card} viewer={viewer} canEdit={canEdit} columns={everyColumn} />

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

interface ColumnSectionProps {
  /** The live column the card stands in; null while its board's columns are not read. */
  current: ColumnRow | null;
  /** The columns it may move to — the board's live ones; none where it is read only. */
  columns: readonly ColumnRow[];
  /** The card's stage: its column's word until the columns are read. */
  fallbackKey: string;
  onMove: (column: ColumnRow) => void;
}

/** «Колонка»: the board's live columns as buttons, the card's own chosen; else its column's name. */
function ColumnSection({ current, columns, fallbackKey, onMove }: ColumnSectionProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const name = current === null ? t(`problems.statuses.${fallbackKey}`) : columnLabel(current, t);
  return (
    <View style={styles.section}>
      <Text variant="chip" tone="secondary">
        {t('boards.column')}
      </Text>
      {columns.length === 0 ? (
        <Text>{name}</Text>
      ) : (
        <ChoiceChips
          options={columns.map((column) => ({ value: column.id, label: columnLabel(column, t) }))}
          value={current?.id ?? ''}
          onChange={(columnId: string) => {
            const column = columns.find((one) => one.id === columnId);
            if (column !== undefined) {
              onMove(column);
            }
          }}
          accessibilityLabel={t('boards.moveTo')}
          semantics="radio"
        />
      )}
    </View>
  );
}

/**
 * Who works on the card. Every manager and admin picks from the company's active managers and
 * admins, or «Без исполнителя» (one push goes to the new assignee); on an archived board — and on
 * a board the viewer does not see — it is read.
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
