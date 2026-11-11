import { canRetryGuestMessage, formatGuestMessageTime, type GuestMessage } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';

import { useGuestMessage } from './use-guest-message';

interface GuestMessageBlockProps {
  problemId: string;
}

/**
 * «Сообщение гостя» on the screen of a task a guest's chat made (owner, 2026-11-11), for the head
 * technician and the office: the message the card was raised on and the guest's words around it,
 * read from Hostaway on a press — never before — and kept nowhere: the screen holds them while it is
 * open, the note says so. Each state in its own words: loading, the messages, the term over, Hostaway
 * down, no rights, the limit; a press again where it may help.
 */
export function GuestMessageBlock({ problemId }: GuestMessageBlockProps) {
  const { t } = useTranslation();
  const { read, ask } = useGuestMessage(problemId);

  return (
    <View testID="guest-message" style={styles.block}>
      <Text variant="caption" tone="secondary" weight={700}>
        {t('problems.guestMessage.title')}
      </Text>
      {read.phase === 'idle' ? (
        <Button label={t('problems.guestMessage.show')} variant="outline" onPress={ask} />
      ) : null}
      {read.phase === 'loading' ? (
        <Text tone="secondary" accessibilityLiveRegion="polite">
          {t('problems.guestMessage.loading')}
        </Text>
      ) : null}
      {read.phase === 'failed' ? (
        <>
          <Text testID="guest-message-failure" tone="secondary" accessibilityLiveRegion="polite">
            {t(`problems.guestMessage.${read.failure}`)}
          </Text>
          {canRetryGuestMessage(read.failure) ? (
            <Button label={t('problems.guestMessage.retry')} variant="outline" onPress={ask} />
          ) : null}
        </>
      ) : null}
      {read.phase === 'shown' ? <Messages messages={read.messages} /> : null}
    </View>
  );
}

/** The messages in the order sent, each with its day and time; the flagged one says so. */
function Messages({ messages }: { messages: readonly GuestMessage[] }) {
  const { t, i18n } = useTranslation();
  return (
    <View style={styles.list} accessibilityLiveRegion="polite">
      <Text variant="caption" tone="secondary">
        {t('problems.guestMessage.note')}
      </Text>
      {messages.map((message) => {
        const meta = [
          formatGuestMessageTime(message.sent_at, i18n.language),
          message.is_flagged ? t('problems.guestMessage.flagged') : null,
          message.text !== null && message.attachments > 0
            ? t('problems.guestMessage.files', { count: message.attachments })
            : null,
        ].filter((part): part is string => part !== null);
        return (
          <View
            key={message.sent_at}
            testID={message.is_flagged ? 'guest-message-flagged' : 'guest-message-context'}
            style={styles.message}
          >
            <Text variant="caption" tone="secondary" weight={message.is_flagged ? 700 : undefined}>
              {meta.join(' · ')}
            </Text>
            {message.text === null ? (
              <Text tone="secondary">
                {t('problems.guestMessage.noText', { count: message.attachments })}
              </Text>
            ) : (
              <Text>{message.text}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** Sizes only: the colours are the text's. */
const styles = StyleSheet.create({
  // As the screen's other blocks (problem-detail.tsx, `layout.block`).
  block: { gap: Spacing.xs },
  list: { gap: Spacing.sm },
  message: { gap: Spacing.xs },
});
