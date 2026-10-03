import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';

import { Button } from './button';
import { Text } from './text';

export interface EmptyStateProps {
  /** What is empty, said plainly, as `tasks.emptyQueue` does. */
  title: string;
  /** What she can do about it, if anything. */
  message?: string;
  /** Above the words: where a picture goes once the icons arrive (build 1.2.0). */
  icon?: ReactNode;
  action?: { label: string; onPress: () => void };
}

/**
 * An empty list or screen, in words: "nothing to do" must never look like
 * "could not load" (that is `ErrorState`). Not grouped into one element, so
 * the reader still reaches the button.
 */
export function EmptyState({ title, message, icon, action }: EmptyStateProps) {
  return (
    <View style={styles.empty}>
      {icon}
      <Text variant="title" align="center">
        {title}
      </Text>
      {message !== undefined ? (
        <Text tone="secondary" align="center">
          {message}
        </Text>
      ) : null}
      {action !== undefined ? (
        <Button
          variant="secondary"
          label={action.label}
          onPress={action.onPress}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.xl,
  },
  action: { marginTop: Spacing.sm },
});
