import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import type { TFunction } from 'i18next';

/** Which code the phone runs: what «О приложении» says, and what a report to the owner needs. */
export interface BuildInfo {
  /** The app's version (`app.json`); the runtime an update must match. */
  version: string | null;
  /** The update taken over the air, or null on the build it was installed with. */
  updateId: string | null;
  /** The channel the build listens to for updates; null where updates are off. */
  channel: string | null;
}

/** As many characters of an update's id as tell it apart in `eas update:list`. */
const UPDATE_ID_SHOWN = 8;

/** What the phone runs now: read once per launch by expo-updates, so read at will. */
export function readBuildInfo(): BuildInfo {
  return {
    version: Constants.expoConfig?.version ?? null,
    updateId: Updates.isEmbeddedLaunch ? null : Updates.updateId,
    channel: Updates.channel,
  };
}

/** «1.2.0 · обновление 01a12342 · канал preview», or «встроенная сборка» on the installed build. */
export function buildLine(info: BuildInfo, t: TFunction): string {
  const parts = [
    info.version,
    info.updateId === null
      ? t('settings.about.embedded')
      : t('settings.about.update', { id: info.updateId.slice(0, UPDATE_ID_SHOWN) }),
    info.channel === null ? null : t('settings.about.channel', { channel: info.channel }),
  ];
  return parts.filter((part): part is string => part !== null).join(' · ');
}
