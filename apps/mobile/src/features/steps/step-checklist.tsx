import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';

import { CheckRow } from './check-row';
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
  const language = useLanguage();

  if (modules.length === 0) {
    return <Text tone="secondary">{t('steps.checklistEmpty')}</Text>;
  }

  return (
    <View style={styles.list}>
      {modules.map((checklistModule) => (
        <View key={checklistModule.id} style={styles.module}>
          <Text
            accessibilityRole="header"
            variant="caption"
            tone="secondary"
            weight={700}
            style={styles.moduleTitle}
          >
            {localizedTitle(checklistModule, language)}
          </Text>

          {checklistModule.items.map((item) => (
            <CheckRow
              key={item.id}
              label={localizedTitle(item, language)}
              note={item.is_optional ? t('steps.checklistOptional') : undefined}
              accessibilityHint={item.is_optional ? t('steps.checklistOptional') : undefined}
              isChecked={checked.includes(item.id)}
              isDisabled={disabled}
              onToggle={() => onToggle(item.id)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.lg },
  module: { gap: Spacing.xs },
  moduleTitle: { textTransform: 'uppercase' },
});
