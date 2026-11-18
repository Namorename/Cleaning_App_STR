'use client';

import {
  BOARD_COLUMNS,
  BOARD_LIMITS,
  isCardColor,
  isEveryStepDone,
  LAST_BOARD_COLUMN,
  type BoardColumn,
} from '@str-ops/shared';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cardColorStyle, SWATCH_CLASS } from '@/components/board/card-color';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/format-date';
import { serverErrorText, type ServerErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import { CardFieldsForm, draftOf, fieldsOf, type FieldsDraft } from './card-fields';
import { CardJournal } from './card-journal';
import { CardSteps } from './card-steps';
import { DueChip } from './due-chip';
import { boardKeys } from './keys';
import { LinkedText } from './linked-text';
import {
  assignablePeople,
  canEditBoard,
  canWorkOn,
  cardPlace,
  shelfOf,
  type Board,
  type BoardViewer,
  type CardDetail,
  type CardShelf,
} from './schema';
import {
  useCard,
  useDuplicateCard,
  useMoveCard,
  useOfficePeople,
  useSaveCard,
  useSetCardAssignee,
  useSetCardShelf,
} from './use-boards';

interface CardDialogProps {
  cardId: string;
  board: Board;
  viewer: BoardViewer;
  today: string;
  onClose: () => void;
  /** The card left the board (archived or deleted): the board says so, with «Отменить». */
  onShelved: (card: CardDetail, shelf: CardShelf) => void;
  /** A copy was made: the board opens it. */
  onDuplicated: (cardId: string) => void;
  /** The list on screen a move shows in at once: the board's cards by default. */
  listKey?: readonly unknown[];
}

/**
 * A card over its board: the fields (its links open), the assignee, the steps, the column, and
 * the journal beside them. The board's owner and an admin change all of it; the card's assignee
 * works on it — fields, steps, column, journal — but does not assign it, copy it or shelve it; any
 * other manager reads it. A card in the archive or among the deleted is read until «Вернуть».
 */
export function CardDialog(props: CardDialogProps) {
  const { t } = useTranslation();
  const card = useCard(props.cardId);

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        {/* A refresh that fails keeps the card read before it, with what is being typed. */}
        {card.data === undefined && !card.isError ? (
          <>
            <DialogTitle className="sr-only">{t('boards.cardLoading')}</DialogTitle>
            <LoadingState>{t('boards.cardLoading')}</LoadingState>
          </>
        ) : card.data === undefined ? (
          <>
            <DialogTitle className="sr-only">{t('boards.cardLoadError')}</DialogTitle>
            <ErrorState message={t('boards.cardLoadError')} error={card.error} />
          </>
        ) : card.data === null ? (
          <DialogHeader>
            <DialogTitle>{t('boards.cardGone')}</DialogTitle>
          </DialogHeader>
        ) : (
          <CardBody {...props} card={card.data} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CardBody({
  card,
  board,
  viewer,
  today,
  onShelved,
  onDuplicated,
  listKey,
}: CardDialogProps & { card: CardDetail }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const move = useMoveCard(listKey ?? boardKeys.cards(board.id));
  const shelve = useSetCardShelf();
  const duplicate = useDuplicateCard();
  const [dismissedDone, setDismissedDone] = useState(false);
  // The latest failure only: an older one never outlives a later success.
  const [failure, setFailure] = useState<ServerErrorText | null>(null);
  // The copy «Дублировать» is making: a repeat after a lost answer is the same copy.
  const copyId = useRef<string | null>(null);
  // A card of another board in the address is read, never changed from this one's rights.
  const isOwnBoard = card.board_id === board.id;
  const boardEditable = canEditBoard(board, viewer) && isOwnBoard;
  const shelf = shelfOf(card);
  const canEdit = canWorkOn(board, card, viewer) && isOwnBoard && shelf === 'active';
  const offersDone =
    canEdit &&
    !dismissedDone &&
    card.column_key !== LAST_BOARD_COLUMN &&
    isEveryStepDone(card.steps);

  const lastColumn = t(`problems.statuses.${LAST_BOARD_COLUMN}`);
  const outcome = (onSuccess?: () => void) => ({
    onSuccess: () => {
      setFailure(null);
      onSuccess?.();
    },
    onError: (error: unknown) => setFailure(serverErrorText(error)),
  });

  const moveTo = (column: BoardColumn) => {
    if (column !== card.column_key) {
      move.mutate({ cardId: card.id, column }, outcome());
    }
  };
  const putOn = (next: CardShelf) =>
    shelve.mutate(
      { cardId: card.id, shelf: next },
      outcome(() => onShelved(card, next)),
    );
  const copy = () => {
    if (duplicate.isPending) {
      return;
    }
    const cardId = copyId.current ?? crypto.randomUUID();
    copyId.current = cardId;
    const title = t('boards.copyTitle', { title: card.title }).slice(0, BOARD_LIMITS.cardTitle);
    duplicate.mutate(
      { sourceId: card.id, cardId, title },
      outcome(() => {
        copyId.current = null;
        onDuplicated(cardId);
      }),
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="break-words">{card.title}</DialogTitle>
        <DialogDescription>
          {t('boards.created', {
            when: formatDateTime(card.created_at, language),
            name: card.creator?.full_name ?? t('boards.unknownPerson'),
          })}
        </DialogDescription>
      </DialogHeader>

      {shelf === 'active' ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3 text-sm">
          <span>{t('boards.shelvedNote')}</span>
          {boardEditable ? (
            <Button
              type="button"
              className="h-11"
              disabled={shelve.isPending}
              onClick={() => putOn('active')}
            >
              {t('boards.restoreCard')}
            </Button>
          ) : null}
        </div>
      )}

      {offersDone ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-highlight p-3 text-sm text-highlight-foreground"
        >
          <span>{t('boards.allStepsDone', { column: lastColumn })}</span>
          <div className="flex gap-2">
            <Button
              type="button"
              className="h-11"
              disabled={move.isPending}
              onClick={() => moveTo(LAST_BOARD_COLUMN)}
            >
              {t('boards.moveIt')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setDismissedDone(true)}
            >
              {t('boards.notNow')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <ColumnLine card={card} canEdit={canEdit} onMove={moveTo} />
          <AssigneeLine card={card} canAssign={boardEditable && shelf === 'active'} />
          <CardFields card={card} today={today} canEdit={canEdit} />
          <CardSteps card={card} canEdit={canEdit} />
          {boardEditable && shelf === 'active' ? (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={duplicate.isPending}
                onClick={copy}
              >
                {t('boards.duplicate')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={shelve.isPending}
                onClick={() => putOn('archived')}
              >
                {t('boards.archiveCard')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 text-destructive"
                disabled={shelve.isPending}
                onClick={() => putOn('deleted')}
              >
                {t('boards.deleteCard')}
              </Button>
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
        </div>
        <CardJournal card={card} viewer={viewer} canEdit={canEdit} />
      </div>
    </>
  );
}

/**
 * The card's column as four buttons, the current one pressed: a move is a
 * press, never the side effect of arrowing through a list (WCAG 3.2.2). The
 * move shows at once (useMoveCard) and goes back if the server refuses.
 */
function ColumnLine({
  card,
  canEdit,
  onMove,
}: {
  card: CardDetail;
  canEdit: boolean;
  onMove: (column: BoardColumn) => void;
}) {
  const { t } = useTranslation();
  if (!canEdit) {
    return (
      <p className="text-sm">
        <span className="text-muted-foreground">{t('boards.column')}: </span>
        {t(`problems.statuses.${card.column_key}`)}
      </p>
    );
  }
  return (
    <div role="group" aria-label={t('boards.moveTo')} className="flex flex-col gap-1">
      <span className="text-sm font-medium">{t('boards.column')}</span>
      <div className="flex flex-wrap gap-2">
        {BOARD_COLUMNS.map((column) => (
          <Button
            key={column}
            type="button"
            variant={column === card.column_key ? 'default' : 'outline'}
            aria-pressed={column === card.column_key}
            className="h-11"
            onClick={() => onMove(column)}
          >
            {t(`problems.statuses.${column}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Who works on the card. The board's owner and an admin pick from the company's active managers and
 * admins, or «Без исполнителя», in a menu — a press assigns, never arrowing through a list (one
 * push goes to the new assignee); anybody else reads the name.
 */
function AssigneeLine({ card, canAssign }: { card: CardDetail; canAssign: boolean }) {
  const { t } = useTranslation();
  const people = useOfficePeople();
  const assign = useSetCardAssignee();
  const failure = assign.isError ? serverErrorText(assign.error) : null;
  const name =
    card.assignee_id === null
      ? t('boards.noAssignee')
      : (card.assignee?.full_name ?? t('boards.unknownPerson'));
  const choose = (assigneeId: string | null) => {
    if (assigneeId !== card.assignee_id && !assign.isPending) {
      assign.mutate({ cardId: card.id, assigneeId });
    }
  };

  if (!canAssign) {
    return (
      <p className="text-sm">
        <span className="text-muted-foreground">{t('boards.assignee')}: </span>
        {name}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{t('boards.assignee')}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button type="button" variant="outline" className="h-11 self-start" />}
          disabled={assign.isPending}
          aria-label={`${t('boards.assignee')}: ${name}`}
        >
          {name}
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {assignablePeople(people.data ?? []).map((person) => (
            <DropdownMenuItem key={person.id} onClick={() => choose(person.id)}>
              {person.full_name ?? t('boards.unknownPerson')}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => choose(null)}>{t('boards.noAssignee')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
        </p>
      )}
    </div>
  );
}

/** The fields as read, and «Изменить» that turns them into the form. */
function CardFields({
  card,
  today,
  canEdit,
}: {
  card: CardDetail;
  today: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const save = useSaveCard();
  const [draft, setDraft] = useState<FieldsDraft | null>(null);
  const failure = save.isError ? serverErrorText(save.error) : null;
  const place = cardPlace(card);
  // The card's own place, kept selectable when it is no longer offered (archived).
  const currentPlace = useMemo(
    () => (card.property_id === null ? null : { id: card.property_id, name: place ?? '—' }),
    [card.property_id, place],
  );

  if (draft !== null && canEdit) {
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (draft.title.trim() === '' || save.isPending) {
        return;
      }
      save.mutate(
        { cardId: card.id, boardId: card.board_id, fields: fieldsOf(draft) },
        { onSuccess: () => setDraft(null) },
      );
    };
    return (
      <form onSubmit={submit} className="flex flex-col gap-4">
        <CardFieldsForm
          draft={draft}
          onChange={setDraft}
          idPrefix={`card-${card.id}`}
          currentPlace={currentPlace}
        />
        {failure === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {failure.text}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={save.isPending}
            onClick={() => {
              save.reset();
              setDraft(null);
            }}
          >
            {t('boards.cancel')}
          </Button>
          <Button
            type="submit"
            className="h-11"
            disabled={save.isPending || draft.title.trim() === ''}
          >
            {t('boards.save')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {card.description.trim() === '' ? (
        <p className="text-sm text-muted-foreground">{t('boards.noDescription')}</p>
      ) : (
        <LinkedText text={card.description} className="text-sm" />
      )}
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('boards.due')}</dt>
        <dd>
          {card.due_on === null ? (
            t('boards.noDue')
          ) : (
            <DueChip dueOn={card.due_on} column={card.column_key} today={today} />
          )}
        </dd>
        <dt className="text-muted-foreground">{t('boards.property')}</dt>
        <dd>{place ?? t('boards.noProperty')}</dd>
        <dt className="text-muted-foreground">{t('boards.color')}</dt>
        <dd className="flex items-center gap-2">
          {isCardColor(card.color) ? (
            <>
              <span
                aria-hidden="true"
                style={cardColorStyle(card.color)}
                className={`size-4 rounded-full ${SWATCH_CLASS}`}
              />
              {t(`boards.colors.${card.color}`)}
            </>
          ) : (
            t('boards.noColor')
          )}
        </dd>
      </dl>
      {canEdit ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 self-start"
          onClick={() => setDraft(draftOf(card))}
        >
          {t('boards.edit')}
        </Button>
      ) : null}
    </div>
  );
}
