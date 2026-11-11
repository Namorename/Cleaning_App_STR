import {
  STATUS_TONE,
  closingLines,
  jobTail,
  problemPriorityTone,
  problemStatusTone,
  statusIcon,
  todayInZone,
  type JobTail,
} from '@str-ops/shared';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { closingRowOf } from '@/features/problems/closing';
import { problemPlace, problemStatusText } from '@/features/problems/format';
import {
  SIGNAL_BADGE_TONE,
  shownTitle,
  signalBadges,
  signalLabel,
  signalSource,
  signalSourceWord,
} from '@/features/problems/signal-source';
import { SourceBadge } from '@/features/problems/source-badge';
import { useTheme } from '@/hooks/use-theme';

import { personName, repairWhen } from './format';
import { isLive, liveRepair, type BoardProblem, type BoardRepair } from './schema';

/**
 * How long a live task's repair has hung past its day, or null (owner,
 * 2026-11-05). The days are counted in the listing's own zone and the line is
 * OVERDUE_AFTER_DAYS — the panel's rule, from the same place (packages/shared,
 * schedule/job-tail.ts), so the board and «Задания» never disagree.
 */
function repairTail(problem: BoardProblem, repair: BoardRepair | null, now: Date): JobTail | null {
  if (repair === null || repair.scheduled_date === null || !isLive(problem)) {
    return null;
  }
  return jobTail(repair.scheduled_date, todayInZone(problem.property?.timezone, now));
}

interface BoardCardProps {
  problem: BoardProblem;
  /** The directory's names by id (`staffNames`). */
  names: ReadonlyMap<string, string>;
  onPress: (problemId: string) => void;
  /** Somebody wrote in its conversation since he last looked. */
  hasUnread?: boolean;
}

/**
 * A task on the head technician's board (brief, item 1): the title, the
 * status in its tone, the place, who holds the live repair and its day. A task
 * nobody holds while it still waits says «Без исполнителя» in the unassigned
 * tone — dashed, with the dashed person (decision 3) — and a closed one says
 * nothing of a person: it waits for nobody. Red is for what still needs doing
 * (decision 3): «Срочно» and «Просрочено» — a live repair OVERDUE_AFTER_DAYS
 * days or more past its day — only while the task is live, never on a closed
 * or archived one. Before that a repair past its day says, neutral, how many
 * days it hangs («Висит N дней», owner 2026-11-05). A task a guest's review or
 * chat made leads its pills with the source chip (`SourceBadge`, owner
 * 2026-11-11). One card, one button, as her own list has it.
 */
function BoardCardComponent({ problem, names, onPress, hasUnread = false }: BoardCardProps) {
  const { t, i18n } = useTranslation();
  const title = shownTitle(problem, i18n.language);
  const source = signalSource(problem);
  const signal = signalLabel(problem, t);
  const plaques = signalBadges(problem, t);
  const repair = liveRepair(problem);
  const holder = repair?.assignee_id ?? null;
  const status = problemStatusText(problem.status);
  const place = problemPlace(problem);
  const person = holder === null ? null : personName(names, holder);
  const isWaiting = holder === null && isLive(problem);
  const nobody = t('problems.board.nobody');
  const when = repair === null ? null : repairWhen(repair);
  const isUrgent = problem.priority === 'high' && isLive(problem);
  const urgent = t('supplies.priorities.urgent');
  const tail = repairTail(problem, repair, new Date());
  const overdue = tail?.isOverdue === true ? t('problems.board.overdue') : null;
  const hanging = tail === null ? null : t('problems.board.hanging', { count: tail.days });
  const archived = problem.archived_at === null ? null : t('problems.board.archived');
  const label = [
    title,
    signalSourceWord(problem, t),
    signal,
    ...plaques,
    place,
    status,
    overdue,
    hanging,
    person ?? (isWaiting ? nobody : null),
    when,
    isUrgent ? urgent : null,
    archived,
    hasUnread ? t('chat.unread') : null,
  ]
    .filter((part) => part !== null)
    .join('. ');

  return (
    <Card accessibilityLabel={label} onPress={() => onPress(problem.id)}>
      <Text variant="title" numberOfLines={2}>
        {title}
      </Text>
      {signal === null ? null : <Text tone="secondary">{signal}</Text>}
      <View testID="board-marks" style={styles.marks}>
        {source === null ? null : <SourceBadge testID="board-source" source={source} />}
        {hasUnread ? <Badge label={t('chat.unread')} tone={STATUS_TONE['chat.unread']} /> : null}
        <Badge label={status} tone={problemStatusTone(problem.status)} />
        {overdue === null ? null : (
          <Badge
            testID="board-overdue"
            label={overdue}
            tone={STATUS_TONE['calendar.overdueRepair']}
          />
        )}
        {hanging === null ? null : (
          <Badge testID="board-hanging" label={hanging} tone={STATUS_TONE['tasks.hanging']} />
        )}
        {isUrgent ? <Badge label={urgent} tone={problemPriorityTone('high')} /> : null}
        {archived === null ? null : (
          <Badge
            label={archived}
            tone={STATUS_TONE['problems.archived']}
            left={<Icon name="status.archived" size="small" tone="secondary" />}
          />
        )}
        {plaques.map((plaque) => (
          <Badge key={plaque} label={plaque} tone={SIGNAL_BADGE_TONE} />
        ))}
      </View>
      <Text tone="secondary">{place}</Text>
      {person !== null ? <Holder name={person} /> : null}
      {isWaiting ? <Nobody label={nobody} /> : null}
      {closingLines(closingRowOf(problem), t).map((line) => (
        <Text key={line} variant="caption" tone="secondary">
          {line}
        </Text>
      ))}
      {when !== null ? (
        <Text variant="caption" tone="secondary">
          {when}
        </Text>
      ) : null}
    </Card>
  );
}

export const BoardCard = memo(BoardCardComponent);

interface HolderProps {
  name: string;
}

/** The person on the repair, beside the technician's wrench (`meta.technician`). */
function Holder({ name }: HolderProps) {
  return (
    <View style={styles.holder}>
      <Icon name="meta.technician" size="small" tone="secondary" />
      <Text style={styles.name}>{name}</Text>
    </View>
  );
}

interface NobodyProps {
  label: string;
}

/** «Без исполнителя»: the unassigned tone's pill, framed dashed, with the dashed person. */
export function Nobody({ label }: NobodyProps) {
  const theme = useTheme();
  const tone = STATUS_TONE['calendar.nobody'];
  const glyph = statusIcon('calendar.nobody');

  return (
    <Badge
      testID="board-nobody"
      label={label}
      tone={tone}
      left={
        glyph === null ? undefined : <Icon name={glyph} size="small" color={theme.tone[tone].fg} />
      }
    />
  );
}

/** Sizes only: the colours are the components'. */
const styles = StyleSheet.create({
  // The pills wrap under the title, as on her own cards (problem-card.tsx).
  marks: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  holder: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  name: { flexShrink: 1 },
});
