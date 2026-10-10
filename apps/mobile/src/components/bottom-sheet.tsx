import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';

import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { useKeyboardOffset, useScreenEdgePadding } from './bottom-inset';
import { Text } from './text';

/** The grab bar at the top of the sheet: a cue, not a control. */
const HANDLE = { width: 40, height: 4 } as const;

export interface BottomSheetProps {
  isVisible: boolean;
  /** Said first when the sheet opens; a header for the reader. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}

/**
 * A sheet from the bottom of the screen over a darkened page, on React
 * Native's own `Modal` — no native module, so it ships over the air. Closed by
 * its close button (`common.close`), by the system's back (Android) or by a
 * tap on the darkened page; the reader gets the button, the tap-outside is for
 * the finger. Fades in, or appears at once when the phone asks for less motion.
 */
export function BottomSheet({ isVisible, title, onClose, children, testID }: BottomSheetProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const isReduced = useReducedMotion();
  // The Modal draws edge to edge, under the system's bar: the sheet's last
  // row rises by it, and the keyboard's lift takes it back (bottom-inset.ts).
  // No header over a Modal.
  const edge = useScreenEdgePadding(Spacing.lg);
  const keyboardOffset = useKeyboardOffset();

  return (
    <Modal
      testID={testID}
      visible={isVisible}
      transparent
      animationType={isReduced ? 'none' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* The Modal draws edge to edge and the system does not shrink it for the
          keyboard: the sheet rises by itself, or a search in it would hide its
          rows under the keys. */}
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={keyboardOffset}
        style={styles.screen}
      >
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
        />
        <View testID="bottom-sheet-panel" style={[styles.sheet, edge]}>
          <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no" />
          <View style={styles.header}>
            <Text variant="title" accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              hitSlop={Spacing.sm}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Text tone="primary" weight={700}>
                {t('common.close')}
              </Text>
            </Pressable>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFill, backgroundColor: theme.scrim },
    sheet: {
      maxHeight: '90%',
      backgroundColor: theme.card,
      borderTopLeftRadius: Radius.sheet,
      borderTopRightRadius: Radius.sheet,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      gap: Spacing.md,
    },
    handle: {
      alignSelf: 'center',
      width: HANDLE.width,
      height: HANDLE.height,
      borderRadius: HANDLE.height / 2,
      backgroundColor: theme.divider,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    title: { flex: 1 },
    close: {
      minHeight: MIN_TOUCH_TARGET,
      minWidth: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { opacity: 0.6 },
  });
