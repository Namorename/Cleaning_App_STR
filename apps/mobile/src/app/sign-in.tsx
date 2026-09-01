import { Redirect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing } from '@/constants/theme';
import { signIn, useSession } from '@/features/auth/session';

export default function SignInScreen() {
  const { userId } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = useCallback(async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (caught: unknown) {
      // The reason is never spelled out: telling an attacker which half was
      // wrong turns the login form into an account enumerator.
      setError(caught instanceof Error ? 'Неверная почта или пароль.' : 'Не удалось войти.');
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password]);

  if (userId !== null) {
    return <Redirect href="/(tabs)" />;
  }

  const canSubmit = email.trim().length > 0 && password.length > 0 && !isSubmitting;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <Text style={styles.heading}>Вход для клинеров</Text>

        <View style={styles.field}>
          <Text style={styles.label} nativeID="email-label">
            Почта
          </Text>
          <TextInput
            accessibilityLabelledBy="email-label"
            accessibilityLabel="Почта"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            style={styles.input}
            textContentType="username"
            value={email}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label} nativeID="password-label">
            Пароль
          </Text>
          <TextInput
            accessibilityLabelledBy="password-label"
            accessibilityLabel="Пароль"
            autoCapitalize="none"
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            textContentType="password"
            value={password}
          />
        </View>

        {error !== null ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Войти"
          accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
          disabled={!canSubmit}
          onPress={() => void onSubmit()}
          style={({ pressed }) => [
            styles.button,
            !canSubmit && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {isSubmitting ? <ActivityIndicator /> : <Text style={styles.buttonText}>Войти</Text>}
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', padding: Spacing.xl, gap: Spacing.lg },
  heading: { fontSize: FontSize.heading, fontWeight: '700', marginBottom: Spacing.sm },
  field: { gap: Spacing.xs },
  label: { fontSize: FontSize.body, color: '#60646C' },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D6D8DE',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    fontSize: FontSize.title,
  },
  error: { color: '#B3261E', fontSize: FontSize.body },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.md,
    backgroundColor: '#208AEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.75 },
  buttonText: { color: '#FFFFFF', fontSize: FontSize.title, fontWeight: '600' },
});
