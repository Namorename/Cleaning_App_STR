import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { FailureText } from '@/components/failure-text';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { Spacing } from '@/constants/theme';
import { wordContext } from '@/i18n';

import {
  MAX_OFF_REASON_LENGTH,
  isReasonRequired,
  reasonToSend,
  type CleaningOffKind,
} from './offs';

/** The sheet's words for each way off: its question, what follows, and its «yes». */
interface OffWords {
  title: string;
  text: string;
  confirm: string;
}

const OFF_WORDS: Readonly<Record<CleaningOffKind, OffWords>> = {
  decline: {
    title: 'tasks.offs.declineTitle',
    text: 'tasks.offs.declineText',
    confirm: 'tasks.offs.decline',
  },
  interrupt: {
    title: 'tasks.offs.interruptTitle',
    text: 'tasks.offs.interruptText',
    confirm: 'tasks.offs.interruptConfirm',
  },
  cancel: {
    title: 'tasks.offs.cancelTitle',
    text: 'tasks.offs.cancelText',
    confirm: 'tasks.offs.cancelConfirm',
  },
};

interface HandBackSheetProps {
  kind: CleaningOffKind;
  /** The answer is on its way: «yes» spins, and a second tap sends nothing. */
  isBusy: boolean;
  /** The last attempt's failure, said on the sheet, which stays open with her words. */
  error: Error | null;
  /** Her words as sent: trimmed, null when she wrote none. */
  onConfirm: (reason: string | null) => void;
  /** Closing leaves an answer on its way alone: it still lands. */
  onClose: () => void;
}

/**
 * The question before a cleaning is taken off — her decline or interrupt, the
 * office's cancel: what follows from it, and a reason in her own words, which
 * only the office reads (task_events.reason). An interrupt needs one, as the
 * server does (`serverErrors.reasonRequired`): its «yes» waits for a word that
 * is not blank. The app's own sheet, never the system's Alert; a refusal is
 * said on it, in her language, and she may try again from it.
 */
export function HandBackSheet({ kind, isBusy, error, onConfirm, onClose }: HandBackSheetProps) {
  const { t } = useTranslation();
  // The reader's words: a technician hands back work, not a cleaning.
  const context = wordContext();
  const [reason, setReason] = useState('');
  const words = OFF_WORDS[kind];
  const isRequired = isReasonRequired(kind);
  const toSend = reasonToSend(reason);
  const isMissing = isRequired && toSend === null;

  const confirm = () => {
    if (isBusy || isMissing) {
      return;
    }
    onConfirm(toSend);
  };

  return (
    <BottomSheet
      testID="hand-back-sheet"
      isVisible
      title={t(words.title, { context })}
      onClose={onClose}
    >
      <ScrollView contentContainerStyle={layout.body} keyboardShouldPersistTaps="handled">
        <Text tone="secondary">{t(words.text, { context })}</Text>
        <View style={layout.field}>
          <TextField
            label={t(isRequired ? 'tasks.offs.reason' : 'tasks.offs.reasonOptional')}
            isDisabled={isBusy}
            maxLength={MAX_OFF_REASON_LENGTH}
            multiline
            onChangeText={setReason}
            value={reason}
          />
          <Text variant="caption" tone="secondary" align="right">
            {reason.length} / {MAX_OFF_REASON_LENGTH}
          </Text>
        </View>
      </ScrollView>
      {error !== null ? <FailureText error={error} /> : null}
      <Button
        variant="destructive"
        label={t(words.confirm, { context })}
        isDisabled={isMissing}
        isBusy={isBusy}
        onPress={confirm}
      />
      <Button variant="outline" label={t('tasks.offs.keep')} onPress={onClose} />
    </BottomSheet>
  );
}

/** Sizes only: the colours are the components'. */
const layout = StyleSheet.create({
  body: { gap: Spacing.md },
  field: { gap: Spacing.xs },
});
