import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { MIN_TOUCH_TARGET } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The size a header icon is drawn at, in Material and SF Symbols alike. */
const ICON_SIZE = 24;

const GEAR: SymbolViewProps['name'] = {
  ios: 'gearshape',
  android: 'settings',
  web: 'settings',
};

/**
 * The gear in the tab header, where "Sign out" used to be. An icon alone, so
 * its name is spoken from the label: the title of the screen it opens.
 */
export function SettingsButton() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('settings.title')}
      onPress={() => router.push('/settings')}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <SymbolView name={GEAR} size={ICON_SIZE} tintColor={theme.primary} />
    </Pressable>
  );
}

/** For `headerRight`, which is called as a function, not drawn as a component. */
export function renderSettingsButton() {
  return <SettingsButton />;
}

const styles = StyleSheet.create({
  button: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
});
