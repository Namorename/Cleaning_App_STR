import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { Language } from '@/i18n';

import { FailureNote, SettingsSection, failureOf } from './section';
import { useChangeLanguage } from './use-settings';

/**
 * The languages on offer, in the order the panel lists them to the manager.
 * Each is named in its own language: a cleaner stuck in one she cannot read
 * still finds hers.
 */
export const LANGUAGE_CHOICES = ['ru', 'en', 'cs'] as const satisfies readonly Language[];

/**
 * Her language, chosen by herself. It is the same field the manager sets in
 * the panel (`profiles.preferred_language`), so there is one answer to "what
 * does she read" and it is whoever chose last.
 */
export function LanguageSection() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const language = useLanguage();
  const change = useChangeLanguage();

  const onSelect = (next: Language) => {
    if (next !== language) {
      change.mutate(next);
    }
  };

  return (
    <SettingsSection title={t('settings.language.heading')}>
      <View accessibilityRole="radiogroup" style={styles.choices}>
        {LANGUAGE_CHOICES.map((code) => (
          <LanguageChoice
            key={code}
            label={t(`common.languages.${code}`)}
            isSelected={code === language}
            // One change at a time: a second tap while the first is being
            // saved would leave a refusal nothing sensible to go back to.
            isDisabled={change.isPending}
            onSelect={() => onSelect(code)}
            styles={styles}
          />
        ))}
      </View>
      {change.isError ? (
        <FailureNote failure={failureOf(change.error, 'settings.language.saveFailed')} />
      ) : null}
    </SettingsSection>
  );
}

interface LanguageChoiceProps {
  label: string;
  isSelected: boolean;
  isDisabled: boolean;
  onSelect: () => void;
  styles: ReturnType<typeof createStyles>;
}

function LanguageChoice({ label, isSelected, isDisabled, onSelect, styles }: LanguageChoiceProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: isSelected, checked: isSelected, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.chip,
        isSelected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    chip: {
      minHeight: MIN_TOUCH_TARGET,
      paddingHorizontal: Spacing.lg,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.card,
      justifyContent: 'center',
    },
    chipSelected: { backgroundColor: theme.primary, borderColor: theme.primary },
    chipText: { color: theme.text, fontSize: FontSize.body, fontWeight: '600' },
    chipTextSelected: { color: theme.onPrimary },
    pressed: { opacity: 0.75 },
  });
