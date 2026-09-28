import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { profileKeys } from '@/features/profile/keys';
import { applyLanguage, currentLanguage, type Language } from '@/i18n';
import { readCached } from '@/lib/read-cached';

import { fetchMyPushPreferences, saveMyLanguage, setPushPreference } from './api';
import { settingsKeys, settingsMutationKeys } from './keys';
import { changePassword, type PasswordChange } from './password';
import {
  cachedPushPreferencesSchema,
  isPushEnabled,
  pushPreferencesFrom,
  withPushChoice,
  type PushKind,
  type PushPreferences,
} from './schema';

/** One switch set to the value she wants. The user id names the cached row. */
export interface PushChoice {
  userId: string;
  kind: PushKind;
  enabled: boolean;
}

interface PushChoiceContext {
  /** Where the switch stood before the tap: where a refusal puts it back. */
  wasEnabled: boolean;
}

/**
 * Choices go out one after another, in the order she made them. Each says a
 * value, not a flip, but two values for the same kind sent side by side could
 * still land in the wrong order and leave the one she did not want.
 */
const PUSH_SCOPE = { id: 'settings-push' };

/**
 * Her row as it came back from disk, read like outside input (`readCached`):
 * a row saved in an older shape gains what it lacks, and a kind this build
 * does not know is dropped. Module-level so the query runs it only when the
 * data changes.
 */
function readPushPreferences(data: unknown): PushPreferences | null {
  return readCached(cachedPushPreferencesSchema, data, 'push preferences');
}

/**
 * What a push choice does to the cache, the same for a tap and for a replay
 * after a restart: the switch moves at once, the server's row settles it, and
 * a refusal puts that one switch back and asks the server what is true.
 */
function pushChoiceOptions(
  queryClient: QueryClient,
): UseMutationOptions<PushPreferences, Error, PushChoice, PushChoiceContext> {
  return {
    mutationFn: ({ kind, enabled }) => setPushPreference(kind, enabled),
    scope: PUSH_SCOPE,
    onMutate: async ({ userId, kind, enabled }) => {
      const key = settingsKeys.push(userId);
      await queryClient.cancelQueries({ queryKey: key });
      const before: unknown = queryClient.getQueryData(key);
      queryClient.setQueryData(key, withPushChoice(before, userId, kind, enabled));
      return { wasEnabled: isPushEnabled(pushPreferencesFrom(before), kind) };
    },
    onSuccess: (row, { userId }) => {
      queryClient.setQueryData(settingsKeys.push(userId), row);
    },
    onError: (_error, { userId, kind }, context) => {
      const key = settingsKeys.push(userId);
      if (context !== undefined) {
        queryClient.setQueryData(key, (current: unknown) =>
          withPushChoice(current, userId, kind, context.wasEnabled),
        );
      }
      void queryClient.invalidateQueries({ queryKey: key });
    },
  };
}

/**
 * Teach the query client how to replay a push choice after a restart.
 * Called once, before the persisted cache is restored.
 */
export function registerSettingsMutations(queryClient: QueryClient): void {
  queryClient.setMutationDefaults(settingsMutationKeys.push, pushChoiceOptions(queryClient));
}

/** Her row of switched-off pushes; null when she never switched one off. */
export function usePushPreferences() {
  const { userId } = useSession();

  return useQuery({
    queryKey: settingsKeys.push(userId ?? 'nobody'),
    queryFn: () => fetchMyPushPreferences(userId ?? ''),
    select: readPushPreferences,
    enabled: userId !== null,
  });
}

/**
 * Switch one push on or off. 'offlineFirst' like every other write: without
 * signal it waits on disk and goes through on its own later.
 */
export function useSetPushPreference() {
  const queryClient = useQueryClient();

  return useMutation<PushPreferences, Error, PushChoice, PushChoiceContext>({
    mutationKey: settingsMutationKeys.push,
    ...pushChoiceOptions(queryClient),
  });
}

interface LanguageContext {
  previous: Language;
}

/**
 * Read in another language from this tap on, and keep it.
 *
 * The switch is made first, before the network is asked: waiting on a
 * stairwell's signal to redraw the screen would read as a tap that did not
 * work. The profile is written next — the gate reads it on every start — and
 * a refusal puts the language back as it was, for the gate would put it back
 * anyway on the next start, and a language that changes on its own is worse
 * than one that did not change.
 *
 * Never paused and never replayed ('always'): a language write queued on disk
 * and sent after a restart could undo a choice she made since.
 */
export function useChangeLanguage() {
  const { userId } = useSession();
  const queryClient = useQueryClient();

  return useMutation<void, Error, Language, LanguageContext>({
    mutationFn: (language) => saveMyLanguage(userId ?? '', language),
    networkMode: 'always',
    onMutate: async (language) => {
      const previous = currentLanguage();
      await applyLanguage(language);
      return { previous };
    },
    onError: (_error, _language, context) => {
      if (context !== undefined) {
        void applyLanguage(context.previous);
      }
    },
    onSettled: () => {
      if (userId !== null) {
        void queryClient.invalidateQueries({ queryKey: profileKeys.language(userId) });
      }
    },
  });
}

/**
 * Change her password. Online only, and never written to disk: a paused
 * mutation is saved with its variables, and these variables are passwords.
 * 'always' never pauses, so it is never saved; no retry, because a second
 * sign-in attempt only brings the rate limit closer.
 */
export function useChangePassword() {
  return useMutation<void, unknown, PasswordChange>({
    mutationFn: changePassword,
    networkMode: 'always',
    retry: false,
  });
}
