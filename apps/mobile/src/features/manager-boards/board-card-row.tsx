import { dueState, stepCount } from '@str-ops/shared';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { formatDue, useCardColor } from './format';
import { cardPlace, type BoardCard } from './schema';

interface BoardCardRowProps {
  card: BoardCard;
  /** The phone's day, `YYYY-MM-DD`. */
  today: string;
  onPress: (cardId: string) => void;
}

/**
 * One card of a manager board on the phone: its colour as a stripe and a faint
 * fill, the title, the place, the due date — red past it, honey on it — and
 * «3/7» with a thin bar. The whole card opens it.
 */
function BoardCardRowComponent({ card, today, onPress }: BoardCardRowProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const color = useCardColor(card.color);
  const place = cardPlace(card);
  const { done, total } = stepCount(card.steps);
  const state = dueState(card.due_on, today, card.column_key);
  const dueText =
    card.due_on === null
      ? null
      : state === 'overdue'
        ? t('boards.dueChip.overdue', { day: formatDue(card.due_on) })
        : state === 'today'
          ? t('boards.dueChip.today')
          : t('boards.dueChip.day', { day: formatDue(card.due_on) });
  const label = [
    card.title,
    color === null ? null : t(`boards.colors.${card.color}`),
    place,
    dueText,
    total === 0 ? null : t('boards.progress', { done, total }),
  ]
    .filter((part) => part !== null)
    .join('. ');

  return (
    <Card
      accessibilityLabel={label}
      onPress={() => onPress(card.id)}
      style={
        color === null
          ? undefined
          : [styles.colored, { borderLeftColor: color.stripe, backgroundColor: color.tint }]
      }
    >
      <Text variant="title" numberOfLines={3}>
        {card.title}
      </Text>
      {place === null ? null : <Text tone="secondary">{place}</Text>}
      {dueText === null ? null : state === 'overdue' || state === 'today' ? (
        <View style={styles.row}>
          <Badge label={dueText} tone={state === 'overdue' ? 'overdue' : 'today'} />
        </View>
      ) : (
        <Text variant="caption" tone="secondary">
          {dueText}
        </Text>
      )}
      {total === 0 ? null : (
        <View style={styles.progress}>
          <Text variant="caption" tone="secondary">
            {done}/{total}
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round((done / total) * 100)}%` }]} />
          </View>
        </View>
      )}
    </Card>
  );
}

export const BoardCardRow = memo(BoardCardRowComponent);

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    colored: { borderLeftWidth: 5 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
    progress: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    track: {
      flex: 1,
      height: 4,
      borderRadius: Radius.pill,
      backgroundColor: theme.surfaceAlt,
      overflow: 'hidden',
    },
    fill: { height: 4, borderRadius: Radius.pill, backgroundColor: theme.primary },
  });
