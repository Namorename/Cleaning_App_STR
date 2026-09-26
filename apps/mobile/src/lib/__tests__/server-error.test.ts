import { i18n } from '@/i18n';

import { RefusalError, alertMessage, serverErrorText } from '../server-error';

/** An error as supabase-js hands a database refusal over. */
function raised(hint: string | null, message: string, details?: string) {
  return Object.assign(new Error(message), { hint, details });
}

describe('a refusal that counts', () => {
  afterEach(async () => {
    await i18n.changeLanguage('ru');
  });

  // The server names its number after what it counts ("total", "limit");
  // i18next picks a plural form only from `count`.
  test('agrees with the number, read from the parameter the server named', async () => {
    await i18n.changeLanguage('cs');
    const text = (total: number) =>
      serverErrorText(
        raised(
          'serverErrors.propertyHasOpenTasks',
          `The listing has ${total} open tasks`,
          JSON.stringify({ total }),
        ),
      ).text;

    expect(text(1)).toContain('má 1 nedokončený úkol');
    expect(text(3)).toContain('má 3 nedokončené úkoly');
    expect(text(7)).toContain('má 7 nedokončených úkolů');
  });

  test('reads a limit of one file in the singular', () => {
    const failure = serverErrorText(
      raised(
        'serverErrors.mediaLimitReached',
        'The step already holds 1 of at most 1 files',
        '{"limit":1}',
      ),
    );

    expect(failure).toEqual({ text: 'Сюда можно приложить не больше 1 файла', detail: null });
  });

  test('without its number becomes the general sentence, the server words kept', () => {
    const failure = serverErrorText(
      raised('serverErrors.propertyHasOpenTasks', 'The listing has open tasks', '{}'),
    );

    expect(failure.text).toBe('Не удалось выполнить действие. Попробуйте ещё раз.');
    expect(failure.detail).toBe('The listing has open tasks');
  });
});

describe('a key the app knows', () => {
  test('is read in the language of the app, not of the server', () => {
    const failure = serverErrorText(
      raised('serverErrors.stepNotFound', 'Step not found, or its task is not in progress'),
    );

    expect(failure.text).toBe('Шаг не найден или задача уже не в работе');
    // Nothing of the server's English survives: it would only confuse.
    expect(failure.detail).toBeNull();
  });

  test('fills its parameters in from the JSON the server sent', () => {
    const failure = serverErrorText(
      raised('serverErrors.requiredStepsLeft', 'Required steps are still open: 3', '{"count":3}'),
    );

    expect(failure.text).toBe('Обязательных шагов осталось: 3');
  });

  test('survives details that are not the JSON object it expected', () => {
    const failure = serverErrorText(
      raised(
        'serverErrors.commentTooLong',
        'The comment is longer than 4000 characters',
        'nonsense',
      ),
    );

    expect(failure.text).toContain('Комментарий длиннее');
  });
});

describe('anything else', () => {
  test('becomes one sentence, with the server words kept underneath', () => {
    const failure = serverErrorText(new Error('Network request failed'));

    expect(failure.text).toBe('Не удалось выполнить действие. Попробуйте ещё раз.');
    expect(failure.detail).toBe('Network request failed');
  });

  test('a key from a later build than this one falls back the same way', () => {
    // The contract is stable, but a migration may run ahead of the app.
    const failure = serverErrorText(raised('serverErrors.notInThisBuild', 'Something new'));

    expect(failure.text).toBe('Не удалось выполнить действие. Попробуйте ещё раз.');
    expect(failure.detail).toBe('Something new');
  });

  test('a hint that is not ours — Postgres writes its own — is not looked up', () => {
    const failure = serverErrorText(raised('Perhaps you meant to reference the column', 'boom'));

    expect(failure.text).toBe('Не удалось выполнить действие. Попробуйте ещё раз.');
    expect(failure.detail).toBe('boom');
  });

  test('a thrown string leaves nothing to show but the sentence', () => {
    const failure = serverErrorText('boom');

    expect(failure.text).toBe('Не удалось выполнить действие. Попробуйте ещё раз.');
    expect(failure.detail).toBeNull();
  });
});

describe('a refusal the app read off an answer itself', () => {
  test('is translated by its key, and its English stays in the logs', () => {
    // An update that matched no row says "no" without an error: the app
    // raises it in the server's shape, English for the logs and a key.
    const failure = serverErrorText(
      new RefusalError('Claim matched no row: taken or past its day', 'tasks.claimTaken'),
    );

    expect(failure.text).toBe('Задачу уже взяли, либо её срок истёк.');
    expect(failure.detail).toBeNull();
  });

  test('with a key this build does not have, falls back like any other failure', () => {
    const failure = serverErrorText(new RefusalError('Something new', 'tasks.notInThisBuild'));

    expect(failure.text).toBe('Не удалось выполнить действие. Попробуйте ещё раз.');
    expect(failure.detail).toBe('Something new');
  });
});

describe('an alert, which has no small print', () => {
  test('is the sentence alone when there is nothing to pass on', () => {
    expect(alertMessage({ text: 'Задачу уже взяли.', detail: null })).toBe('Задачу уже взяли.');
  });

  test('keeps the raw words as a paragraph of their own under the sentence', () => {
    expect(
      alertMessage({ text: 'Не удалось выполнить действие.', detail: 'Network request failed' }),
    ).toBe('Не удалось выполнить действие.\n\nNetwork request failed');
  });
});
