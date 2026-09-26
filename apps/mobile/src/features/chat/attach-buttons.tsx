import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { MIN_TOUCH_TARGET, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The size a toolbar icon is drawn at, in Material and SF Symbols alike. */
const ICON_SIZE = 24;

const CAMERA: SymbolViewProps['name'] = {
  ios: 'camera',
  android: 'photo_camera',
  web: 'photo_camera',
};
const GALLERY: SymbolViewProps['name'] = {
  ios: 'photo.on.rectangle',
  android: 'photo_library',
  web: 'photo_library',
};

interface AttachButtonsProps {
  /** Photos already chosen for the next message. */
  taken: number;
  max: number;
  onTakePhoto: () => void;
  onPickPhoto?: () => void;
  isCapturing: boolean;
}

/**
 * The camera and the gallery beside the box, the way a messenger has them.
 *
 * They used to be the 112-point tiles of a report's strip, and in a chat they
 * pushed the conversation off the screen. Here each is a 24-point icon on a
 * full 48-point target; the count the tile printed is read out instead. Both
 * close once the message holds as many photos as the server will take.
 */
export function AttachButtons({
  taken,
  max,
  onTakePhoto,
  onPickPhoto,
  isCapturing,
}: AttachButtonsProps) {
  const { t } = useTranslation();
  const isDisabled = isCapturing || taken >= max;
  const count = { text: t('media.count', { taken, max }) };

  return (
    <View style={styles.row}>
      <IconButton
        icon={CAMERA}
        label={t('media.takePhoto')}
        count={count}
        isDisabled={isDisabled}
        isBusy={isCapturing}
        onPress={onTakePhoto}
      />
      {onPickPhoto !== undefined ? (
        <IconButton
          icon={GALLERY}
          label={t('steps.pickPhoto')}
          count={count}
          isDisabled={isDisabled}
          isBusy={isCapturing}
          onPress={onPickPhoto}
        />
      ) : null}
    </View>
  );
}

interface IconButtonProps {
  icon: SymbolViewProps['name'];
  label: string;
  count: { text: string };
  isDisabled: boolean;
  isBusy: boolean;
  onPress: () => void;
}

function IconButton({ icon, label, count, isDisabled, isBusy, onPress }: IconButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={count}
      accessibilityState={{ disabled: isDisabled, busy: isBusy }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isDisabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <SymbolView name={icon} size={ICON_SIZE} tintColor={theme.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  button: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
});
