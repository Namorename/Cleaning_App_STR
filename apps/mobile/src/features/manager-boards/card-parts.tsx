import {
  BOARD_LIMITS,
  CARD_COLOR_NAMES,
  splitLinks,
  stepCount,
  type CardColor,
} from '@str-ops/shared';
import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { IconButton } from '@/components/icon-button';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';
import { reportError } from '@/lib/sentry';

import { ActionsSheet } from './board-sheets';
import { entrySentence, formatStamp, useCardColor } from './format';
import {
  canDeleteComment,
  canEditComment,
  orderedEntries,
  orderedSteps,
  type BoardViewer,
  type CardDetail,
  type CardEntry,
  type CardStep,
} from './schema';
import {
  useDeleteComment,
  useDeleteStep,
  useOrderSteps,
  useSaveComment,
  useSaveStep,
  useSetStepDone,
} from './use-boards';

/** A card's words with their `http(s)://` links opening in the browser. */
export function LinkedText({ text }: { text: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <Text selectable>
      {splitLinks(text).map((part, index) =>
        part.kind === 'link' ? (
          <Text
            key={index}
            tone="link"
            style={styles.link}
            accessibilityRole="link"
            onPress={() => {
              Linking.openURL(part.href).catch((error: unknown) => reportError(error));
            }}
          >
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

/** The palette as named swatches and «Без цвета»: one choice. */
export function ColorChoice({
  value,
  onChange,
}: {
  value: CardColor | null;
  onChange: (color: CardColor | null) => void;
}) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  return (
    <View
      style={styles.swatches}
      accessibilityRole="radiogroup"
      accessibilityLabel={t('boards.color')}
    >
      {([null, ...CARD_COLOR_NAMES] as const).map((color) => (
        <Swatch
          key={color ?? 'none'}
          color={color}
          isChosen={color === value}
          onPress={() => onChange(color)}
        />
      ))}
    </View>
  );
}

function Swatch({
  color,
  isChosen,
  onPress,
}: {
  color: CardColor | null;
  isChosen: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const values = useCardColor(color);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: isChosen }}
      accessibilityLabel={color === null ? t('boards.noColor') : t(`boards.colors.${color}`)}
      onPress={onPress}
      style={[styles.toggle, isChosen && styles.toggleOn]}
    >
      <View
        style={[
          styles.swatch,
          values === null ? styles.noSwatch : { backgroundColor: values.stripe },
        ]}
      />
    </Pressable>
  );
}

/**
 * A card's checklist: tick, add at the end, and from a step's «⋯» change its
 * words, move it up or down, delete it. A tick shows at once.
 */
export function CardStepsList({ card, canEdit }: { card: CardDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const steps = orderedSteps(card.steps);
  const tick = useSetStepDone(card.id);
  const save = useSaveStep();
  const remove = useDeleteStep();
  const order = useOrderSteps();
  const [newBody, setNewBody] = useState('');
  const [newId, setNewId] = useState(() => randomUUID());
  const [menuFor, setMenuFor] = useState<CardStep | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const failed = [tick, save, remove, order].find((mutation) => mutation.isError);
  const { done, total } = stepCount(steps);

  const add = () => {
    const body = newBody.trim();
    if (body === '' || save.isPending) {
      return;
    }
    save.mutate(
      { stepId: newId, cardId: card.id, body },
      {
        onSuccess: () => {
          setNewBody('');
          setNewId(randomUUID());
        },
      },
    );
  };

  const move = (step: CardStep, delta: -1 | 1) => {
    const ids = steps.map((one) => one.id);
    const index = ids.indexOf(step.id);
    const other = index + delta;
    if (index < 0 || other < 0 || other >= ids.length) {
      return;
    }
    [ids[index], ids[other]] = [ids[other], ids[index]];
    order.mutate({ cardId: card.id, stepIds: ids });
  };

  return (
    <View style={styles.section}>
      <Text variant="title">{t('boards.steps')}</Text>
      {total === 0 ? null : (
        <Text variant="caption" tone="secondary">
          {t('boards.progress', { done, total })}
        </Text>
      )}
      {steps.map((step) =>
        editing?.id === step.id ? (
          <View key={step.id} style={styles.editRow}>
            <TextField
              label={t('boards.editStep')}
              value={editing.body}
              onChangeText={(body) => setEditing({ id: step.id, body })}
              maxLength={BOARD_LIMITS.step}
              onSubmitEditing={() =>
                save.mutate(
                  { stepId: step.id, cardId: null, body: editing.body },
                  { onSuccess: () => setEditing(null) },
                )
              }
            />
            <Button label={t('boards.cancel')} variant="outline" onPress={() => setEditing(null)} />
          </View>
        ) : (
          <View key={step.id} style={styles.stepRow}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: step.done_at !== null, disabled: !canEdit }}
              accessibilityLabel={step.body}
              disabled={!canEdit}
              onPress={() => tick.mutate({ stepId: step.id, done: step.done_at === null })}
              style={styles.stepTick}
            >
              <View style={[styles.box, step.done_at !== null && styles.boxDone]}>
                {step.done_at !== null ? <Text tone="onPrimary">✓</Text> : null}
              </View>
              <Text style={styles.stepText} tone={step.done_at !== null ? 'secondary' : 'default'}>
                {step.body}
              </Text>
            </Pressable>
            {canEdit ? (
              <IconButton
                icon="action.more"
                accessibilityLabel={t('boards.stepMenu', { step: step.body })}
                onPress={() => setMenuFor(step)}
              />
            ) : null}
          </View>
        ),
      )}
      {canEdit ? (
        <TextField
          label={t('boards.addStep')}
          value={newBody}
          onChangeText={setNewBody}
          maxLength={BOARD_LIMITS.step}
          placeholder={t('boards.newStep')}
          returnKeyType="done"
          onSubmitEditing={add}
          isDisabled={save.isPending}
        />
      ) : null}
      {failed === undefined ? null : (
        <Text tone="danger">{serverErrorText(failed.error).text}</Text>
      )}
      <ActionsSheet
        isVisible={menuFor !== null}
        title={menuFor?.body ?? ''}
        onClose={() => setMenuFor(null)}
        actions={
          menuFor === null
            ? []
            : [
                {
                  label: t('boards.editStep'),
                  onPress: () => setEditing({ id: menuFor.id, body: menuFor.body }),
                },
                { label: t('boards.stepUp'), onPress: () => move(menuFor, -1) },
                { label: t('boards.stepDown'), onPress: () => move(menuFor, 1) },
                {
                  label: t('boards.deleteStep'),
                  isDestructive: true,
                  onPress: () => remove.mutate(menuFor.id),
                },
              ]
        }
      />
    </View>
  );
}

/**
 * A card's journal, oldest first, the newest at the bottom: comments with
 * their author and the phone's own clock, «изменено» on a changed one, and the
 * server's short lines. Its author changes or deletes a comment; an admin
 * deletes any.
 */
export function CardJournalList({
  card,
  viewer,
  canEdit,
}: {
  card: CardDetail;
  viewer: BoardViewer;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const save = useSaveComment();
  const remove = useDeleteComment();
  const [body, setBody] = useState('');
  const [entryId, setEntryId] = useState(() => randomUUID());
  const [menuFor, setMenuFor] = useState<CardEntry | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [deleting, setDeleting] = useState<CardEntry | null>(null);
  const failed = [save, remove].find((mutation) => mutation.isError);

  const send = () => {
    const words = body.trim();
    if (words === '' || save.isPending) {
      return;
    }
    save.mutate(
      { entryId, cardId: card.id, body: words },
      {
        onSuccess: () => {
          setBody('');
          setEntryId(randomUUID());
        },
      },
    );
  };

  const entries = orderedEntries(card.entries);
  return (
    <View style={styles.section}>
      <Text variant="title">{t('boards.journal')}</Text>
      {entries.length === 0 ? <Text tone="secondary">{t('boards.journalEmpty')}</Text> : null}
      {entries.map((entry) => {
        const mayEdit = canEdit && canEditComment(entry, viewer);
        const mayDelete = canEdit && canDeleteComment(entry, viewer);
        return (
          <View key={entry.id} style={styles.entry}>
            <View style={styles.entryHead}>
              <Text variant="caption" tone="secondary" style={styles.entryMeta}>
                {[
                  entry.author?.full_name ?? t('boards.unknownPerson'),
                  formatStamp(entry.created_at),
                  entry.edited_at === null ? null : t('boards.edited'),
                ]
                  .filter((part) => part !== null)
                  .join(' · ')}
              </Text>
              {mayEdit || mayDelete ? (
                <IconButton
                  icon="action.more"
                  accessibilityLabel={t('boards.commentMenu')}
                  onPress={() => setMenuFor(entry)}
                />
              ) : null}
            </View>
            {entry.kind !== 'comment' ? (
              <Text tone="secondary">{entrySentence(entry, t)}</Text>
            ) : editing?.id === entry.id ? (
              <View style={styles.editRow}>
                <TextField
                  label={t('boards.editComment')}
                  value={editing.body}
                  onChangeText={(next) => setEditing({ id: entry.id, body: next })}
                  maxLength={BOARD_LIMITS.comment}
                  multiline
                />
                <Button
                  label={t('boards.save')}
                  isBusy={save.isPending}
                  isDisabled={editing.body.trim() === ''}
                  onPress={() =>
                    save.mutate(
                      { entryId: entry.id, cardId: null, body: editing.body },
                      { onSuccess: () => setEditing(null) },
                    )
                  }
                />
                <Button
                  label={t('boards.cancel')}
                  variant="outline"
                  onPress={() => setEditing(null)}
                />
              </View>
            ) : (
              <LinkedText text={entry.body ?? ''} />
            )}
          </View>
        );
      })}
      {canEdit ? (
        <View style={styles.editRow}>
          <TextField
            label={t('boards.commentPlaceholder')}
            value={body}
            onChangeText={setBody}
            maxLength={BOARD_LIMITS.comment}
            multiline
          />
          <Button
            label={t('boards.addComment')}
            isBusy={save.isPending}
            isDisabled={body.trim() === ''}
            onPress={send}
          />
        </View>
      ) : null}
      {failed === undefined ? null : (
        <Text tone="danger">{serverErrorText(failed.error).text}</Text>
      )}
      <ActionsSheet
        isVisible={menuFor !== null}
        title={t('boards.journal')}
        onClose={() => setMenuFor(null)}
        actions={
          menuFor === null
            ? []
            : [
                ...(canEdit && canEditComment(menuFor, viewer)
                  ? [
                      {
                        label: t('boards.editComment'),
                        onPress: () => setEditing({ id: menuFor.id, body: menuFor.body ?? '' }),
                      },
                    ]
                  : []),
                ...(canEdit && canDeleteComment(menuFor, viewer)
                  ? [
                      {
                        label: t('boards.deleteComment'),
                        isDestructive: true,
                        onPress: () => setDeleting(menuFor),
                      },
                    ]
                  : []),
              ]
        }
      />
      <ConfirmDialog
        isVisible={deleting !== null}
        title={t('boards.deleteCommentTitle')}
        message={t('boards.deleteCommentText')}
        confirmLabel={t('boards.deleteComment')}
        cancelLabel={t('boards.cancel')}
        variant="destructive"
        onConfirm={() => {
          if (deleting !== null) {
            remove.mutate(deleting.id);
          }
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    link: { textDecorationLine: 'underline' },
    section: { gap: Spacing.sm },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
    toggle: {
      width: MIN_TOUCH_TARGET,
      height: MIN_TOUCH_TARGET,
      borderRadius: Radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
    },
    toggleOn: { borderWidth: 3, borderColor: theme.text },
    swatch: { width: 26, height: 26, borderRadius: Radius.pill },
    noSwatch: { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.textSecondary },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    stepTick: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      minHeight: MIN_TOUCH_TARGET,
    },
    box: {
      width: 24,
      height: 24,
      borderRadius: Radius.md,
      borderWidth: 2,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxDone: { backgroundColor: theme.primary, borderColor: theme.primary },
    stepText: { flex: 1 },
    editRow: { gap: Spacing.sm },
    entry: {
      gap: Spacing.xs,
      paddingLeft: Spacing.sm,
      borderLeftWidth: 2,
      borderLeftColor: theme.divider,
    },
    entryHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    entryMeta: { flex: 1 },
  });
