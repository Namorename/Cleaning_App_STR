import { AppState, type AppStateStatus } from 'react-native';

import type { TusAwayWatch, TusPresence } from './tus';

/**
 * Not in front of her: put away, or passing through the app switcher. Any
 * other answer — 'active', or none yet at start — is the front: an upload must
 * never wait for an 'active' that has already come.
 */
function isAway(state: AppStateStatus | null | undefined): boolean {
  return state === 'background' || state === 'inactive';
}

/**
 * The app's place in front, as the resumable upload needs it
 * (docs/tech-plan.md §7.5, «Фон»). iOS stops JavaScript in the background and
 * cuts the request on the wire; the upload then waits for her to come back
 * and carries on from the storage's offset, rather than spend its tries on
 * what was the system's doing.
 */
export const appPresence: TusPresence = {
  watchAway(): TusAwayWatch {
    let hasLeft = isAway(AppState.currentState);
    const subscription = AppState.addEventListener('change', (state) => {
      if (isAway(state)) {
        hasLeft = true;
      }
    });
    return {
      hasLeft: () => hasLeft,
      stop: () => subscription.remove(),
    };
  },

  untilInFront(): Promise<void> {
    if (!isAway(AppState.currentState)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const subscription = AppState.addEventListener('change', (state) => {
        if (!isAway(state)) {
          subscription.remove();
          resolve();
        }
      });
    });
  },
};
