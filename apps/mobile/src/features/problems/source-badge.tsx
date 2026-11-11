import { SIGNAL_SOURCE_LOOK, type GuestSource } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/badge';
import { Icon } from '@/components/icon';
import { useTheme } from '@/hooks/use-theme';

interface SourceBadgeProps {
  /** A task a guest's words made: its review or its chat message. */
  source: GuestSource;
  testID?: string;
}

/**
 * Where a task from a guest came from, at a glance (owner, 2026-11-11): the
 * review's star on gold, «Из отзыва»; the chat's bubble on terracotta, «Из
 * чата» (`SIGNAL_SOURCE_LOOK`). Filled with the tone's mark, unlike every
 * status chip, so it is never read as one; the glyph and the word both, so it
 * is never colour alone. The glyph is hidden from the reader: the word says it.
 */
export function SourceBadge({ source, testID }: SourceBadgeProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const look = SIGNAL_SOURCE_LOOK[source];
  const colors = theme.tone[look.tone];

  return (
    <Badge
      testID={testID}
      label={t(look.label)}
      tone={look.tone}
      isFilled
      left={
        <Icon
          testID={testID === undefined ? undefined : `${testID}-icon`}
          name={look.icon}
          size="small"
          color={colors.onMark ?? colors.fg}
        />
      }
    />
  );
}
