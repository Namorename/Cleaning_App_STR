import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { Spacing } from '@/constants/theme';

import { SettingsSection } from './section';

/**
 * The way into the knowledge base as a whole — the company's rules and every
 * place's instructions she may read, with a search (docs/knowledge-base-step2.md).
 * Here because the gear in every tab's header leads here already: the bar
 * keeps its tabs (the owner's decision of 2026-10-17, no new tab without
 * need). A place's own instructions open from its cleaning's card.
 */
export function KnowledgeSection() {
  const { t } = useTranslation();

  return (
    <SettingsSection title={t('knowledge.title')}>
      {/* The row reaches the card's edges, like the rows of a list. */}
      <View style={styles.rows}>
        <ListRow
          title={t('knowledge.allArticles')}
          subtitle={t('knowledge.sectionHint')}
          left={<Icon name="nav.knowledge" tone="primary" />}
          right={<Icon name="action.next" tone="secondary" />}
          onPress={() => router.push('/knowledge')}
        />
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  rows: { marginHorizontal: -Spacing.lg },
});
