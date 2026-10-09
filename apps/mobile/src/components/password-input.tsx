import { useState, type Ref } from 'react';
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

import { Icon } from './icon';

/** Everything a text field takes, except what the field decides for itself. */
export type PasswordInputProps = Omit<
  TextInputProps,
  'secureTextEntry' | 'keyboardType' | 'autoCorrect' | 'spellCheck'
> & {
  /** Handed on to the input with the rest, as `TextField` hands its own. */
  ref?: Ref<TextInput>;
};

/**
 * A password field with an eye that shows what was typed.
 *
 * The passwords here are generated — twelve letters and digits copied off a
 * letter or read off the manager's screen — and a masked field hides the one
 * wrong letter that makes the sign-in fail. The field opens masked every time;
 * the eye shows the text until it is pressed again. The eye is Lucide's: open
 * while the text is hidden (what a press does), struck through while it is
 * shown, on a 48 dp target at the field's end.
 *
 * A shown password is still a password: nothing corrects, capitalises or
 * suggests it, and on Android the keyboard is told it is a visible password,
 * so it neither offers the text back later nor learns it.
 */
export function PasswordInput({ style, ...props }: PasswordInputProps) {
  const { t } = useTranslation();
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
        <Icon name={isShown ? 'action.hidePassword' : 'action.showPassword'} tone="secondary" />
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
