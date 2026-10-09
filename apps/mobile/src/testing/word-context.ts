import { act } from '@testing-library/react-native';

import { applyWordContext, type WordContext } from '@/i18n';

/**
 * The reader's words for a test: a technician's (`'tech'`) or the key itself
 * (`undefined`). A change redraws every screen that reads words (i18n,
 * `applyWordContext`), so it is made inside `act`, like any update a test
 * causes — a test that takes his words back with the screen still drawn
 * would otherwise update it outside of one.
 */
export async function setWordContext(next: WordContext | undefined): Promise<void> {
  await act(async () => {
    applyWordContext(next);
  });
}
