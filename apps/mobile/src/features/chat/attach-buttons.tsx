import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/icon-button';
import type { MediaSource } from '@/features/media/capture';

interface AttachButtonsProps {
  /** Photos already chosen for the next message. */
  taken: number;
  max: number;
  onTakePhoto: () => void;
  onPickPhoto?: () => void;
  /** Where a photo is being taken from right now: that button spins, the other waits. */
  capturing: MediaSource | null;
}

/**
 * The camera and the gallery beside the box, the way a messenger has them.
 *
 * They used to be the 112-point tiles of a report's strip, and in a chat they
 * pushed the conversation off the screen. Here each is a Lucide icon on a
 * full 48-point target; the count the tile printed is read out instead. Both
 * close once the message holds as many photos as the server will take.
 */
export function AttachButtons({
  taken,
  max,
  onTakePhoto,
  onPickPhoto,
  capturing,
}: AttachButtonsProps) {
  const { t } = useTranslation();
  const isFull = taken >= max;
  const count = { text: t('media.count', { taken, max }) };

  return (
    <View style={styles.row}>
      <IconButton
        icon="action.takePhoto"
        accessibilityLabel={t('media.takePhoto')}
        accessibilityValue={count}
        isDisabled={isFull || capturing === 'gallery'}
        isBusy={capturing === 'camera'}
        onPress={onTakePhoto}
      />
      {onPickPhoto !== undefined ? (
        <IconButton
          icon="action.fromGallery"
          accessibilityLabel={t('steps.pickPhoto')}
          accessibilityValue={count}
          isDisabled={isFull || capturing === 'camera'}
          isBusy={capturing === 'gallery'}
          onPress={onPickPhoto}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
});
