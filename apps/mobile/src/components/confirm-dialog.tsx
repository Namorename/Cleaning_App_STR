import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Radius, Spacing, type Theme } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { Button } from './button';
import { Text } from './text';

/** Wide enough for a question and a place; a tablet does not stretch it across. */
const MAX_WIDTH = 480;

export interface ConfirmDialogProps {
  isVisible: boolean;
  /** The question, said first: «Завершить уборку?». */
  title: string;
  /** One line under it: what the move is about — the place. */
  message?: string;
  confirmLabel: string;
  /** «Отмена» unless the screen says otherwise. */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

/**
 * A question before a move that cannot be taken back, in the app's own look
 * rather than the system's Alert: two 56 dp buttons for a gloved finger, the
 * theme's card over a darkened screen, on React Native's own `Modal` — no
 * native module, so it ships over the air.
 *
 * Answered once per opening: a second tap of either button, the system's back
 * or a tap around the card after the first answer does nothing, so a quick
 * double tap cannot finish a job twice or finish it and then cancel. Shown, it
 * takes the screen reader to the question; on iOS the card keeps the reader
 * inside it. No fixed height: at the largest system text the card grows and
 * scrolls.
 */
export function ConfirmDialog({
  isVisible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  testID = 'confirm-dialog',
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const isReduced = useReducedMotion();
  const questionRef = useRef<View>(null);
  // Each opening is a round of its own; the answer of the last one is
  // remembered by round, so opening the dialog again asks again.
  const [round, setRound] = useState(0);
  const [wasVisible, setWasVisible] = useState(isVisible);
  const [answeredRound, setAnsweredRound] = useState(-1);
  // A tap in the same frame as the first one comes before the state above has
  // been drawn: the ref is what stops it.
  const answeredNow = useRef(-1);

  if (wasVisible !== isVisible) {
    setWasVisible(isVisible);
    if (isVisible) {
      setRound(round + 1);
    }
  }

  const hasAnswered = answeredRound === round;

  const answer = (reply: () => void) => {
    if (answeredNow.current === round) {
      return;
    }
    answeredNow.current = round;
    setAnsweredRound(round);
    reply();
  };

  const focusQuestion = () => {
    if (questionRef.current !== null) {
      AccessibilityInfo.sendAccessibilityEvent(questionRef.current, 'focus');
    }
  };

  return (
    <Modal
      testID={testID}
      visible={isVisible}
      transparent
      animationType={isReduced ? 'none' : 'fade'}
      onRequestClose={() => answer(onCancel)}
      onShow={focusQuestion}
      statusBarTranslucent
    >
      <View style={styles.screen}>
        <Pressable
          testID={`${testID}-backdrop`}
          style={styles.backdrop}
          onPress={() => answer(onCancel)}
          accessible={false}
          importantForAccessibility="no"
        />
        <View testID={`${testID}-card`} style={styles.card} accessibilityViewIsModal>
          <ScrollView
            testID={`${testID}-scroll`}
            contentContainerStyle={styles.content}
            bounces={false}
          >
            <View ref={questionRef} accessible accessibilityRole="header">
              <Text variant="title">{title}</Text>
            </View>
            {message === undefined ? null : <Text tone="secondary">{message}</Text>}
            <View style={styles.buttons}>
              <Button
                label={confirmLabel}
                isDisabled={hasAnswered}
                onPress={() => answer(onConfirm)}
              />
              <Button
                variant="outline"
                label={cancelLabel ?? t('common.cancel')}
                isDisabled={hasAnswered}
                onPress={() => answer(onCancel)}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.lg,
    },
    backdrop: { ...StyleSheet.absoluteFill, backgroundColor: theme.scrim },
    card: {
      width: '100%',
      maxWidth: MAX_WIDTH,
      maxHeight: '90%',
      backgroundColor: theme.card,
      borderRadius: Radius.sheet,
    },
    content: { padding: Spacing.xl, gap: Spacing.md },
    buttons: { gap: Spacing.sm, marginTop: Spacing.sm },
  });
