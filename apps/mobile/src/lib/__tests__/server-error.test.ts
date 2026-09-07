import { serverErrorText } from '../server-error';

/** An error as supabase-js hands a database refusal over. */
function raised(hint: string | null, message: string, details?: string) {
  return Object.assign(new Error(message), { hint, details });
}

describe('a key the app knows', () => {
  test('is read in the language of the app, not of the server', () => {
    const failure = serverErrorText(
      raised('serverErrors.stepNotFound', 'Step not found, or its task is not in progress'),
    );

    expect(failure.text).toBe('Шаг не найден или уборка уже не в работе');
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
