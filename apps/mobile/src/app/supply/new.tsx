import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { ErrorState } from '@/components/error-state';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { BUTTON_HEIGHT, Radius, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { supplyPlace } from '@/features/supplies/format';
import {
  canEditSupplyRequest,
  draftItemsPayload,
  draftOfRequest,
  emptySupplyDraft,
  type SupplyDraft,
} from '@/features/supplies/schema';
import { SupplyForm } from '@/features/supplies/supply-form';
import {
  useSaveSupplyRequest,
  useSupplyCatalog,
  useSupplyRequest,
} from '@/features/supplies/use-supplies';
import { propertyName } from '@/features/tasks/format';
import { useTask } from '@/features/tasks/use-tasks';
import { useScreenTitle } from '@/hooks/use-screen-title';
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
    editingId === null ? emptySupplyDraft() : null,
  );

  const existing = useSupplyRequest(editingId ?? '');
  const task = useTask(taskId ?? '');
  const catalog = useSupplyCatalog();
  const save = useSaveSupplyRequest();

  // A rewrite starts from the row once, then belongs to her fingers. Set
  // while rendering rather than in an effect: React draws again at once with
  // the draft, before anything reaches the screen, and a later refetch finds
  // the draft taken and leaves her typing alone.
  if (draft === null && existing.data) {
    setDraft(draftOfRequest(existing.data));
  }

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

  // The root layout names the screen «Новая заявка»; a rewrite says what it
  // is from the first frame, while the request is still loading too — once,
  // and never on the way back after «Сохранить» (hooks/use-screen-title).
  useScreenTitle(editingId === null ? undefined : t('supplies.editTitle'));

  if (draft === null) {
    // A rewrite that cannot start: nobody to ask as (the query never runs),
    // the request not there, or never loaded — never a skeleton for ever.
    if (userId === null || existing.data === null) {
      return (
        <View style={[styles.screen, styles.centered]}>
          <Text tone="secondary" align="center">
            {t('supplies.notFound')}
          </Text>
        </View>
      );
    }
    if (existing.error) {
      return (
        <View style={styles.screen}>
          <ErrorState
            error={existing.error}
            title={t('common.screenFailed')}
            onRetry={() => void existing.refetch()}
          />
        </View>
      );
    }
    return (
      <View style={styles.screen}>
        <FormSkeleton label={t('supplies.loading')} />
      </View>
    );
  }

  if (existing.data && !canEditSupplyRequest(existing.data, userId)) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text tone="secondary" align="center">
          {t('supplies.notEditable')}
        </Text>
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
    <SupplyForm
      draft={draft}
      onChange={setDraft}
      newKey={randomUUID}
      place={place}
      catalog={catalog.data ?? []}
      isSubmitting={save.isPending && !save.isPaused}
      submitLabel={editingId === null ? t('supplies.submit') : t('supplies.save')}
      onSubmit={onSubmit}
      error={save.error}
    />
  );
}

/** The form's blocks: the catalogue's search, three of its rows, the summary's button. */
const SKELETON_ROW = 64;
const SKELETON_ROWS = 3;

interface FormSkeletonProps {
  /** What is loading, said to the reader. */
  label: string;
}

function FormSkeleton({ label }: FormSkeletonProps) {
  return (
    <SkeletonGroup label={label} style={layout.content}>
      <Skeleton height={BUTTON_HEIGHT} radius={Radius.lg} />
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <Skeleton key={index} height={SKELETON_ROW} radius={Radius.card} />
      ))}
      <Skeleton height={BUTTON_HEIGHT} radius={Radius.pill} />
    </SkeletonGroup>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    centered: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
    },
  });
