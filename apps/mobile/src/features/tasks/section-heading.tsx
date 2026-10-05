import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { formatDayHeading } from './format';
import type { TaskGroup } from './schema';

interface SectionHeadingProps {
  section: TaskGroup;
}

/**
 * The heading of a section of a list of cleanings: «В работе», or the day —
 * «Сегодня», «Завтра», a weekday and date. It stays on top while its day
 * scrolls under it, so it is painted in the screen's own colour, and a screen
 * reader can jump from one day to the next by it.
 */
export function SectionHeading({ section }: SectionHeadingProps) {
  // The hook redraws the heading when she changes language.
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const text =
    section.kind === 'running' ? t('tasks.status.inProgress') : formatDayHeading(section.key);

  return (
    <View style={styles.heading}>
      <Text variant="title" accessibilityRole="header">
        {text}
      </Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    // Closer to its own cards than to the day above it.
    heading: {
      backgroundColor: theme.background,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.sm,
    },
  });
