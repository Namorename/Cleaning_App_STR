import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';

import { CheckRow } from './check-row';

interface StepTaskNoteProps {
  lines: readonly string[];
  checked: readonly number[];
  onToggle: (index: number) => void;
  disabled: boolean;
}

/**
 * The manager's note, one line per tick.
 *
 * Each line is a checkbox the size of a finger: the cleaner reads it at the
 * door with a bag in the other hand. The order of lines is the order of the
 * note; the indexes go to the server as they are.
 */
export function StepTaskNote({ lines, checked, onToggle, disabled }: StepTaskNoteProps) {
  return (
    <View style={styles.list}>
      {lines.map((line, index) => (
        <CheckRow
          key={`${index}-${line}`}
          label={line}
          isChecked={checked.includes(index)}
          isDisabled={disabled}
          onToggle={() => onToggle(index)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.xs },
});
