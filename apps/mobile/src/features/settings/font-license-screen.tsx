import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { licenseBlocks } from './license-blocks';
import { NUNITO_LICENSE } from './nunito-license';

/** Built once: the licence does not change while the app runs. */
const BLOCKS = licenseBlocks(NUNITO_LICENSE);

/**
 * The licence of the app's font, from the settings (OFL FAQ 1.20). A line in
 * her language says what it is; the licence itself stays in English, as its
 * authors publish it, and is read with an English voice on iOS.
 */
export function FontLicenseScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text tone="secondary">{t('settings.fontLicense.intro')}</Text>
      <Card>
        {BLOCKS.map((block, index) => {
          const key = `${block.kind}-${index}`;
          if (block.kind === 'rule') {
            return (
              <View
                key={key}
                style={styles.rule}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            );
          }
          return block.kind === 'heading' ? (
            <Text key={key} variant="title" accessibilityRole="header" accessibilityLanguage="en">
              {block.text}
            </Text>
          ) : (
            <Text key={key} accessibilityLanguage="en" selectable>
              {block.text}
            </Text>
          );
        })}
      </Card>
    </ScrollView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { padding: Spacing.lg, gap: Spacing.lg },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.divider },
  });
