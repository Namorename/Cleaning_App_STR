import { Pressable, StyleSheet, Text } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

interface ListActionProps {
  label: string;
  onPress: () => void;
}

/** The one thing a list lets her start: a full-width button above the cards. */
export function ListAction({ label, onPress }: ListActionProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    button: {
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: Radius.md,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.md,
    },
    pressed: { opacity: 0.75 },
    text: { color: theme.onPrimary, fontSize: FontSize.title, fontWeight: '600' },
  });
