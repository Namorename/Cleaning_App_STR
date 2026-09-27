import { afterEach, describe, expect, test } from 'vitest';

import { formatDay } from '../format-date';
import { i18n, languageFromCookie } from '../i18n';
import { serverErrorText } from '../server-error';

/** An error as supabase-js hands a database refusal over. */
function raised(hint: string, message: string, details: string) {
  return Object.assign(new Error(message), { hint, details });
}

describe('a refusal that counts', () => {
  afterEach(async () => {
    await i18n.changeLanguage('ru');
  });

  // The server names its number after what it counts ("total", "limit");
  // i18next picks a plural form only from `count`.
  test('agrees with the number of open cleanings the listing still has', async () => {
    await i18n.changeLanguage('cs');
    const text = (total: number) =>
      serverErrorText(
        raised(
          'serverErrors.propertyHasOpenTasks',
          `The listing has ${total} open tasks`,
          JSON.stringify({ total }),
        ),
      ).text;

    expect(text(1)).toContain('má 1 nedokončený úklid');
    expect(text(2)).toContain('má 2 nedokončené úklidy');
    expect(text(12)).toContain('má 12 nedokončených úklidů');
  });

  test('reads a limit of one file in the singular', () => {
    const failure = serverErrorText(
      raised(
        'serverErrors.mediaLimitReached',
        'The step holds 1 of at most 1 files',
        '{"limit": 1}',
      ),
    );

    expect(failure).toEqual({ text: 'Сюда можно приложить не больше 1 файла', detail: null });
  });
});

describe('serverErrorText', () => {
  test('translates a key the server sent, with its parameters', () => {
    const error = Object.assign(new Error('The title is longer than 200 characters'), {
      hint: 'serverErrors.problemTitleTooLong',
      details: '{"limit": 200}',
    });

    expect(serverErrorText(error)).toEqual({
      text: 'Заголовок длиннее 200 символов',
      detail: null,
    });
  });

  // The server names a day as YYYY-MM-DD; the manager reads it as a date.
  test('reads a day the server names as a date, in the reader’s language', async () => {
    const moved = raised(
      'serverErrors.taskMovedMeanwhile',
      'Task was moved to 2026-09-18 while the form was open',
      '{"date": "2026-09-18"}',
    );

    expect(serverErrorText(moved).text).toBe(
      `Пока форма была открыта, задание перенесли на ${formatDay('2026-09-18', 'ru')}. Откройте его заново.`,
    );
    expect(serverErrorText(moved).text).not.toContain('2026-09-18');

    await i18n.changeLanguage('cs');
    try {
      expect(serverErrorText(moved).text).toContain(formatDay('2026-09-18', 'cs'));
    } finally {
      await i18n.changeLanguage('ru');
    }
  });

  test('falls back to one sentence and keeps the raw words for an unknown error', () => {
    const result = serverErrorText(new Error('Network request failed'));

    expect(result.text).toBe('Не удалось выполнить действие. Попробуйте ещё раз.');
    expect(result.detail).toBe('Network request failed');
  });
});

describe('languageFromCookie', () => {
  test('takes a supported language from the cookie and Russian otherwise', () => {
    expect(languageFromCookie('cs')).toBe('cs');
    expect(languageFromCookie('de')).toBe('ru');
    expect(languageFromCookie(undefined)).toBe('ru');
  });
});
