import { randomUUID } from 'expo-crypto';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { supplyPlace } from '@/features/supplies/format';
import {
  canEditSupplyRequest,
  draftItemsPayload,
  draftOfRequest,
  emptySupplyDraft,
  newItemDraft,
  type SupplyDraft,
} from '@/features/supplies/schema';
import { SupplyForm } from '@/features/supplies/supply-form';
import { useSaveSupplyRequest, useSupplyRequest } from '@/features/supplies/use-supplies';
import { propertyName } from '@/features/tasks/format';
import { useTask } from '@/features/tasks/use-tasks';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const Params = z.object({
  taskId: z.string().uuid().optional(),
  /** Present when an existing request is being rewritten. */
  id: z.string().uuid().optional(),
});

/**
 * A new request, or a rewrite of one that is still new.
 *
 * The id is minted here for a new request, so a retry after a lost
 * connection replays rather than duplicates. A rewrite reuses the row's id
 * and the server replaces its lines wholesale.
 */
export default function SupplyFormRoute() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { userId } = useSession();
  const parsed = Params.safeParse(useLocalSearchParams());
  const taskId = parsed.success ? (parsed.data.taskId ?? null) : null;
  const editingId = parsed.success ? (parsed.data.id ?? null) : null;

  const [requestId] = useState(() => editingId ?? randomUUID());
  const [draft, setDraft] = useState<SupplyDraft | null>(() =>
    editingId === null ? emptySupplyDraft(randomUUID()) : null,
  );

  const existing = useSupplyRequest(editingId ?? '');
  const task = useTask(taskId ?? '');
  const save = useSaveSupplyRequest();

  useEffect(() => {
    if (draft === null && existing.data) {
      setDraft(draftOfRequest(existing.data));
    }
  }, [draft, existing.data]);

  const isLeaving = save.isSuccess || save.isPaused;
  useEffect(() => {
    if (!isLeaving) {
      return;
    }
    if (editingId === null) {
      router.replace({ pathname: '/supply/[id]', params: { id: requestId } });
    } else {
      router.back();
    }
  }, [isLeaving, editingId, requestId]);

  if (draft === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={styles.message.color} />
        <Text style={styles.message}>{t('supplies.loading')}</Text>
      </View>
    );
  }

  if (existing.data && !canEditSupplyRequest(existing.data, userId)) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>{t('supplies.notEditable')}</Text>
      </View>
    );
  }

  const place = existing.data
    ? supplyPlace(existing.data)
    : task.data
      ? propertyName(task.data)
      : null;

  const onSubmit = () => {
    save.mutate({
      requestId,
      items: draftItemsPayload(draft),
      priority: draft.priority,
      note: draft.note.trim(),
      taskId: existing.data ? existing.data.task_id : taskId,
      propertyId: existing.data ? existing.data.property_id : null,
    });
  };

  return (
    <>
      <Stack.Screen
        options={{ title: editingId === null ? t('supplies.new') : t('supplies.edit') }}
      />
      <SupplyForm
        draft={draft}
        onChange={setDraft}
        onAddItem={() =>
          setDraft({ ...draft, items: [...draft.items, newItemDraft(randomUUID())] })
        }
        place={place}
        isSubmitting={save.isPending && !save.isPaused}
        submitLabel={editingId === null ? t('supplies.submit') : t('supplies.save')}
        onSubmit={onSubmit}
        error={save.error}
      />
    </>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.sm,
      backgroundColor: theme.background,
    },
    message: { color: theme.textSecondary, fontSize: FontSize.body, textAlign: 'center' },
  });
