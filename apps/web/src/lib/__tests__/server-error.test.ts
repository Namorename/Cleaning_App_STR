import { describe, expect, test } from 'vitest';

import { languageFromCookie } from '../i18n';
import { serverErrorText } from '../server-error';

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
