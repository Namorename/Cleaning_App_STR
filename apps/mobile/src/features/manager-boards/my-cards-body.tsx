import {
  BOARD_COLUMNS,
  EMPTY_CARD_FILTERS,
  hasCardFilters,
  localDay,
  matchesCardFilters,
  orderCards,
  type BoardColumn,
  type CardFilters,
  type CardOrder,
} from '@str-ops/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { ChoiceChips } from '@/components/choice-chips';
import { ErrorState } from '@/components/error-state';
import { IconButton } from '@/components/icon-button';
import { LoadingState } from '@/components/loading-state';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { Spacing } from '@/constants/theme';

import { BoardCardRow } from './board-card-row';
import { FiltersSheet } from './board-sheets';
import type { MyCard } from './schema';
import { useMyCards } from './use-boards';

/**
 * «Назначено мне»: the person's cards from every board that is not archived, a stage at a time —
 * the four of the technicians' board, read off each card's key, whatever the columns of its board
 * are called (20261126120000) — each naming its board, or «Закрытая доска» for one she does not
 * see. A card opens on its own screen, where it moves; a new card is made on a board.
 */
export function MyCardsBody() {
  const { t } = useTranslation();
  const cards = useMyCards();
  const [pane, setPane] = useState<BoardColumn>('open');
  const [filters, setFilters] = useState<CardFilters>(EMPTY_CARD_FILTERS);
  const [order, setOrder] = useState<CardOrder>('due');
  const [isFiltering, setIsFiltering] = useState(false);
  const today = localDay();
  const all = cards.data ?? [];
  const matching = all.filter((card) => matchesCardFilters(card, filters, today));
  const panes = BOARD_COLUMNS.map((column) => ({
    value: column,
    label: `${t(`problems.statuses.${column}`)} ${matching.filter((card) => card.column_key === column).length}`,
  }));
  const shown = orderCards(
    matching.filter((card) => card.column_key === pane),
    order,
  );
  const open = (cardId: string) =>
    router.push({ pathname: '/board-card/[id]', params: { id: cardId } });
  const boardLabel = (card: MyCard) =>
    card.board === null
      ? t('boards.privateBoard')
      : t('boards.onBoard', { title: card.board.title });

  const header = (
    <View style={styles.header}>
      <Text variant="heading">{t('boards.assignedToMe')}</Text>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <TextField
            label={t('boards.search')}
            value={filters.query}
            onChangeText={(query) => setFilters({ ...filters, query })}
          />
        </View>
        <IconButton
          icon="action.search"
          accessibilityLabel={t('boards.filters.label')}
          onPress={() => setIsFiltering(true)}
        />
      </View>
      <ChoiceChips
        options={panes}
        value={pane}
        onChange={setPane}
        accessibilityLabel={t('boards.column')}
        semantics="tabs"
      />
    </View>
  );

  return (
    <>
      <FlatList
        // The search sits in the header: a tap with the keyboard up acts, not only hides it.
        keyboardShouldPersistTaps="handled"
        data={shown}
        keyExtractor={(card) => card.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={cards.isRefetching} onRefresh={() => void cards.refetch()} />
        }
        renderItem={({ item }) => (
          <BoardCardRow card={item} today={today} onPress={open} boardLabel={boardLabel(item)} />
        )}
        ListEmptyComponent={
          cards.isPending ? (
            <LoadingState label={t('boards.loading')} />
          ) : cards.isError && cards.data === undefined ? (
            <ErrorState error={cards.error} title={t('boards.loadError')} />
          ) : (
            <Text tone="secondary" align="center">
              {all.length === 0
                ? t('boards.assignedToMeEmpty')
                : hasCardFilters(filters)
                  ? t('boards.columnEmptyFiltered')
                  : t('boards.columnEmpty')}
            </Text>
          )
        }
      />
      <FiltersSheet
        isVisible={isFiltering}
        onClose={() => setIsFiltering(false)}
        filters={filters}
        onChange={setFilters}
        order={order}
        onOrderChange={setOrder}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.md, gap: Spacing.sm },
  header: { gap: Spacing.sm, marginBottom: Spacing.sm },
  searchRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.xs },
  search: { flex: 1 },
});
