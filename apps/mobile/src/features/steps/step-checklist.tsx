import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { currentLanguage } from '@/i18n';

import { localizedTitle, type ChecklistModuleView } from './schema';

interface StepChecklistProps {
  modules: readonly ChecklistModuleView[];
  checked: readonly string[];
  onToggle: (itemId: string) => void;
  disabled: boolean;
}

/**
 * The listing's checklist, module by module.
 *
 * Bathroom, kitchen, bedroom — a heading each, and under it the things to do
 * as checkboxes the size of a finger. An item marked optional says so: it can
 * be left alone and the step still finishes, and a cleaner who does not know
 * that would tick it out of caution.
 *
 * The modules come from the task's own snapshot, so this list is what the
 * cleaning asked for when it started, not what the checklist says now.
 */
export function StepChecklist({ modules, checked, onToggle, disabled }: StepChecklistProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  // useTranslation subscribes this component to a change of language, so
  // reading the active one here re-runs when it changes.
  const language = currentLanguage();

  if (modules.length === 0) {
    return <Text style={styles.empty}>{t('steps.checklistEmpty')}</Text>;
  }

  return (
    <View style={styles.list}>
      {modules.map((checklistModule) => (
        <View key={checklistModule.id} style={styles.module}>
          <Text accessibilityRole="header" style={styles.moduleTitle}>
            {localizedTitle(checklistModule, language)}
          </Text>

          {checklistModule.items.map((item) => {
            const isChecked = checked.includes(item.id);
            const title = localizedTitle(item, language);

            return (
              <Pressable
                key={item.id}
                accessibilityRole="checkbox"
                accessibilityLabel={title}
                accessibilityHint={item.is_optional ? t('steps.checklistOptional') : undefined}
                accessibilityState={{ checked: isChecked, disabled }}
                disabled={disabled}
                onPress={() => onToggle(item.id)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={[styles.box, isChecked && styles.boxChecked]}>
                  {isChecked ? <Text style={styles.tick}>✓</Text> : null}
                </View>
                <View style={styles.itemText}>
                  <Text style={[styles.title, isChecked && styles.titleChecked]}>
                    {title}
                  </Text>
                  {item.is_optional ? (
                    <Text style={styles.optional}>{t('steps.checklistOptional')}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const BOX_SIZE = 26;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: Spacing.lg },
    module: { gap: Spacing.xs },
    moduleTitle: {
      color: theme.textSecondary,
      fontSize: FontSize.caption,
      fontWeight: '700',
      textTransform: 'uppercase',
    },
    empty: { color: theme.textSecondary, fontSize: FontSize.body },
    row: {
      minHeight: MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    rowPressed: { opacity: 0.75 },
    box: {
      width: BOX_SIZE,
      height: BOX_SIZE,
      borderRadius: Radius.md / 2,
      borderWidth: 2,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxChecked: { backgroundColor: theme.primary, borderColor: theme.primary },
    tick: { color: theme.onPrimary, fontSize: FontSize.body, fontWeight: '700' },
    itemText: { flex: 1, gap: 2 },
    title: { color: theme.text, fontSize: FontSize.title },
    titleChecked: { color: theme.textSecondary },
    optional: { color: theme.textSecondary, fontSize: FontSize.caption },
  });
