import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { MIN_TOUCH_TARGET } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The size the eye is drawn at, in Material and SF Symbols alike. */
const ICON_SIZE = 24;

const SHOW: SymbolViewProps['name'] = { ios: 'eye', android: 'visibility', web: 'visibility' };
const HIDE: SymbolViewProps['name'] = {
  ios: 'eye.slash',
  android: 'visibility_off',
  web: 'visibility_off',
};

/** Everything a text field takes, except what the field decides for itself. */
export type PasswordInputProps = Omit<
  TextInputProps,
  'secureTextEntry' | 'keyboardType' | 'autoCorrect' | 'spellCheck'
>;

/**
 * A password field with an eye that shows what was typed.
 *
 * The passwords here are generated — twelve letters and digits copied off a
 * letter or read off the manager's screen — and a masked field hides the one
 * wrong letter that makes the sign-in fail. The field opens masked every time;
 * the eye shows the text until it is pressed again.
 *
 * A shown password is still a password: nothing corrects, capitalises or
 * suggests it, and on Android the keyboard is told it is a visible password,
 * so it neither offers the text back later nor learns it.
 */
export function PasswordInput({ style, ...props }: PasswordInputProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [isShown, setIsShown] = useState(false);

  return (
    <View style={styles.frame}>
      <TextInput
        {...props}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        keyboardType={isShown && Platform.OS === 'android' ? 'visible-password' : 'default'}
        secureTextEntry={!isShown}
        style={[style, styles.roomForEye]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(isShown ? 'auth.hidePassword' : 'auth.showPassword')}
        onPress={() => setIsShown((before) => !before)}
        style={({ pressed }) => [styles.eye, pressed && styles.pressed]}
      >
        <SymbolView name={isShown ? HIDE : SHOW} size={ICON_SIZE} tintColor={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { justifyContent: 'center' },
  // The text stops short of the eye instead of running under it.
  roomForEye: { paddingRight: MIN_TOUCH_TARGET },
  eye: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
});
