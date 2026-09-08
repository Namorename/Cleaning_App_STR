import { useCallback, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

import { SupplyCard } from './supply-card';
import type { SupplyGroup, SupplyRequest } from './schema';

interface SupplyListProps {
  sections: SupplyGroup[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  onPress: (requestId: string) => void;
  header?: ReactElement;
}

/** Her requests, live ones first, closed ones under their own heading. */
export function SupplyList({
  sections,
  isLoading,
  error,
  onRefresh,
  isRefreshing,
  onPress,
  header,
}: SupplyListProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  const renderItem = useCallback(
    ({ item }: { item: SupplyRequest }) => <SupplyCard request={item} onPress={onPress} />,
    [onPress],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: SupplyGroup }) =>
      section.key === 'closed' ? (
        <Text style={styles.heading}>{t('supplies.closedHeading')}</Text>
      ) : null,
    [styles, t],
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={styles.message.color} />
        <Text style={styles.message}>{t('supplies.loading')}</Text>
      </View>
    );
  }

  if (error !== null) {
    const failure = serverErrorText(error);
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{failure.text}</Text>
        {failure.detail !== null ? <Text style={styles.message}>{failure.detail}</Text> : null}
      </View>
    );
  }

  return (
    <SectionList
      sections={sections ?? []}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      renderSectionHeader={renderSectionHeader}
      ListHeaderComponent={header}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={Separator}
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={styles.message}>{t('supplies.emptyMine')}</Text>
        </View>
      }
    />
  );
}

function Separator() {
  const styles = useThemedStyles(createStyles);
  return <View style={styles.separator} />;
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    content: { padding: Spacing.lg, flexGrow: 1 },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.sm,
    },
    message: { color: theme.textSecondary, fontSize: FontSize.body, textAlign: 'center' },
    error: { color: theme.danger, fontSize: FontSize.body, textAlign: 'center' },
    heading: {
      color: theme.textSecondary,
      fontSize: FontSize.caption,
      fontWeight: '700',
      textTransform: 'uppercase',
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.sm,
    },
    separator: { height: Spacing.md },
  });
