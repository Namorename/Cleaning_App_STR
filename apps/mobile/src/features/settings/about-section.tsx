import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { Spacing } from '@/constants/theme';

import { buildLine, readBuildInfo } from './build-info';
import { openPrivacyPolicy } from './privacy-link';
import { SettingsSection } from './section';

/**
 * Which code the phone runs — the version, the update or the installed
 * build, the channel (build-info.ts) — what the app owes to others: the
 * licence of its font (OFL FAQ 1.20) — and the privacy policy, opened in the
 * browser in her language (privacy-link.ts).
 */
export function AboutSection() {
  const { t } = useTranslation();

  return (
    <SettingsSection title={t('settings.about.heading')}>
      {/* The rows reach the card's edges, like the rows of a list. */}
      <View style={styles.rows}>
        <ListRow title={t('settings.about.version')} subtitle={buildLine(readBuildInfo(), t)} />
        <ListRow
          title={t('settings.fontLicense.title')}
          subtitle={t('settings.fontLicense.summary')}
          // The row opens a screen of its own: the chevron says so before the tap.
          right={<Icon name="action.next" tone="secondary" />}
          onPress={() => router.push('/font-license')}
        />
        <ListRow
          title={t('settings.about.privacy')}
          subtitle={t('settings.about.privacyHint')}
          right={<Icon name="action.next" tone="secondary" />}
          onPress={openPrivacyPolicy}
        />
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  rows: { marginHorizontal: -Spacing.lg },
});
