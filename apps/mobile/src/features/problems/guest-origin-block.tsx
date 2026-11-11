import { guestOriginLines, type GuestSource } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';

import { useGuestOrigin } from './use-guest-origin';

interface GuestOriginBlockProps {
  problemId: string;
  /** The task's source (`signalSource`): null for a report of the staff, which has no block. */
  source: GuestSource | null;
}

/**
 * «Гость и проживание» on the screen of a task a guest's review or chat made
 * (owner, 2026-11-11): the stay, and for the head technician the guest's name
 * or why it is not there, the channel and the day it was sent. Which lines a
 * person gets is the server's to decide; the words are the panel's too
 * (`guestOriginLines`). A report of the staff asks nothing and draws nothing.
 */
export function GuestOriginBlock({ problemId, source }: GuestOriginBlockProps) {
  return source === null ? null : <GuestOriginRead problemId={problemId} source={source} />;
}

interface GuestOriginReadProps {
  problemId: string;
  source: GuestSource;
}

/**
 * Nothing while it loads — the task above is what she came for. A read that
 * failed is one quiet line; a task the server says nothing of is no block.
 */
function GuestOriginRead({ problemId, source }: GuestOriginReadProps) {
  const { t, i18n } = useTranslation();
  const origin = useGuestOrigin(problemId, source);

  if (origin.data === undefined) {
    return origin.error === null ? null : (
      <Text testID="problem-origin-failed" tone="secondary">
        {t('problems.origin.loadFailed')}
      </Text>
    );
  }
  if (origin.data === null) {
    return null;
  }

  return (
    <View testID="problem-origin" style={styles.block}>
      <Text variant="caption" tone="secondary" weight={700}>
        {t('problems.origin.title')}
      </Text>
      {guestOriginLines(origin.data, t, i18n.language).map((line) => (
        <Text key={line.key} tone={line.muted ? 'secondary' : 'default'}>
          {line.text}
        </Text>
      ))}
    </View>
  );
}

/** Sizes only: the colours are the text's. */
const styles = StyleSheet.create({
  // As the screen's other blocks (problem-detail.tsx, `layout.block`).
  block: { gap: Spacing.xs },
});
