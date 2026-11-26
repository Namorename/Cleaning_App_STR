import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { ChoiceChips } from '@/components/choice-chips';
import { FailureText } from '@/components/failure-text';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { useStaffDirectory } from '@/features/board/use-board';

import { assignablePeople, type Board, type BoardViewer, type OfficePerson } from './schema';
import { useTransferBoard } from './use-boards';

interface TransferSheetProps {
  isVisible: boolean;
  board: Pick<Board, 'id' | 'title' | 'owner_id' | 'shared'>;
  viewer: BoardViewer;
  onClose: () => void;
  /** Handed over: the new owner's name, for the line that says so. */
  onTransferred: (ownerName: string) => void;
}

/** What the giver keeps after the transfer: an admin sees every board, a manager a shared one. */
function noteKey(board: Pick<Board, 'shared'>, viewer: BoardViewer): string {
  if (viewer.isAdmin) {
    return 'boards.transferNoteAdmin';
  }
  return board.shared ? 'boards.transferNoteShared' : 'boards.transferNotePrivate';
}

/** Who the board can go to: the company's active managers and admins but its owner now. */
export function transferCandidates(
  staff: readonly OfficePerson[],
  board: Pick<Board, 'owner_id'>,
): OfficePerson[] {
  return assignablePeople(staff).filter((person) => person.id !== board.owner_id);
}

/**
 * «Передать доску» (20261126120000): its owner or an admin hands it to another active manager or
 * admin of the company, who gets one push. What the giver keeps of it is said before she confirms;
 * cards, their assignees and who sees the board stay as they are.
 */
export function TransferSheet({
  isVisible,
  board,
  viewer,
  onClose,
  onTransferred,
}: TransferSheetProps) {
  const { t } = useTranslation();
  const staff = useStaffDirectory();
  const transfer = useTransferBoard();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const people = transferCandidates(staff.data ?? [], board);
  const chosen = people.find((person) => person.id === ownerId) ?? null;

  const close = () => {
    if (transfer.isPending) {
      return;
    }
    transfer.reset();
    setOwnerId(null);
    onClose();
  };

  const submit = () => {
    if (chosen === null || transfer.isPending) {
      return;
    }
    const name = chosen.full_name ?? t('boards.unknownPerson');
    transfer.mutate(
      { boardId: board.id, ownerId: chosen.id },
      {
        onSuccess: () => {
          setOwnerId(null);
          onTransferred(name);
        },
      },
    );
  };

  return (
    <BottomSheet
      isVisible={isVisible}
      title={t('boards.transferTitle', { title: board.title })}
      onClose={close}
    >
      <View style={styles.sheet}>
        {staff.data === undefined ? (
          staff.isError ? (
            <FailureText error={staff.error} />
          ) : null
        ) : people.length === 0 ? (
          <Text tone="secondary">{t('boards.transferNobody')}</Text>
        ) : (
          <>
            <Text variant="chip" tone="secondary">
              {t('boards.transferTo')}
            </Text>
            <ChoiceChips
              options={people.map((person) => ({
                value: person.id,
                label: person.full_name ?? t('boards.unknownPerson'),
              }))}
              value={ownerId ?? ''}
              onChange={setOwnerId}
              accessibilityLabel={t('boards.transferTo')}
              semantics="radio"
            />
            {chosen === null ? (
              <Text variant="caption" tone="secondary">
                {t('boards.transferPick')}
              </Text>
            ) : null}
            <Text>{t(noteKey(board, viewer))}</Text>
            <Text variant="caption" tone="secondary">
              {t('boards.transferNoteCards')}
            </Text>
            {transfer.isError ? <FailureText error={transfer.error} /> : null}
            <Button
              label={t('boards.transferConfirm')}
              onPress={submit}
              isDisabled={chosen === null}
              isBusy={transfer.isPending}
            />
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: Spacing.md },
});
