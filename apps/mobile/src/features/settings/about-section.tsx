import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { Spacing } from '@/constants/theme';

import { SettingsSection } from './section';

/** What the app owes to others: for now the licence of its font (OFL FAQ 1.20). */
export function AboutSection() {
  const { t } = useTranslation();

  return (
    <SettingsSection title={t('settings.about.heading')}>
      {/* The row reaches the card's edges, like a row of a list. */}
      <View style={styles.rows}>
        <ListRow
          title={t('settings.fontLicense.title')}
          subtitle={t('settings.fontLicense.summary')}
          // The row opens a screen of its own: the chevron says so before the tap.
          right={<Icon name="action.next" tone="secondary" />}
          onPress={() => router.push('/font-license')}
        />
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  rows: { marginHorizontal: -Spacing.lg },
});
