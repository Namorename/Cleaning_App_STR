import { translations } from '@str-ops/shared';
import { describe, expect, test } from 'vitest';

import { takenOffKey } from '../history';

/**
 * A «taken off» line of a task's history (problem_events, kind taken_off).
 * Switching an account off takes its person off her repairs and says so in the
 * journal: params.cause = 'account_disabled' (20261004100000, owner's answer 3
 * of 2026-10-04). Anything else — the office's «Снять», a cause this build
 * does not know, a row from before — reads as a plain take-off.
 */
describe('the words of a take-off in a task’s history', () => {
  test('a take-off by the switch of an account says so', () => {
    expect(takenOffKey({ assignee: 'b3600005-0000-4000-8000-000000000005', cause: 'account_disabled' }))
      .toBe('panel.problems.history.takenOffAccountDisabled');
  });

  test('the office’s take-off, an unknown cause or no params read as a plain take-off', () => {
    expect(takenOffKey({ assignee: 'b3600005-0000-4000-8000-000000000005' })).toBe(
      'panel.problems.history.takenOff',
    );
    expect(takenOffKey({ cause: 'something_new' })).toBe('panel.problems.history.takenOff');
    expect(takenOffKey(null)).toBe('panel.problems.history.takenOff');
    expect(takenOffKey('not an object')).toBe('panel.problems.history.takenOff');
  });

  test.each(['ru', 'en', 'cs'] as const)('%s has both lines, each naming the person', (language) => {
    const history = (
      translations[language] as unknown as {
        panel: { problems: { history?: Record<string, string> } };
      }
    ).panel.problems.history;

    expect(history?.takenOff).toContain('{{name}}');
    expect(history?.takenOffAccountDisabled).toContain('{{name}}');
  });
});
