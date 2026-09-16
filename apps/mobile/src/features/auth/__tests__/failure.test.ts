import { signInFailureText } from '../failure';

/**
 * The screen answered "wrong email or password" to everything it caught, so a
 * cleaner with a working password was told her password was wrong whenever the
 * stairwell had no signal or auth was rate-limiting her second tap. Then she
 * asks for a new password she never needed — which is what a first password
 * "not working" and a second one "working" looks like from the outside.
 *
 * Tests read Russian: that is the language jest.setup fixes for the app.
 */

test('a wrong pair is reported without saying which half was wrong', () => {
  const failure = signInFailureText({ code: 'invalid_credentials', status: 400 });

  expect(failure.text).toBe('Неверная почта или пароль.');
  expect(failure.detail).toBeNull();
});

test('an older auth build, answering 400 with no code, still reads as a wrong pair', () => {
  const failure = signInFailureText({ status: 400, message: 'Invalid login credentials' });

  expect(failure.text).toBe('Неверная почта или пароль.');
});

test('a dead network says so instead of blaming the password', () => {
  const failure = signInFailureText({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' });

  expect(failure.text).toBe('Нет связи. Проверьте интернет и попробуйте снова.');
});

test('a rate limit asks her to wait, which is the thing that actually helps', () => {
  const failure = signInFailureText({ status: 429, code: 'over_request_rate_limit' });

  expect(failure.text).toBe('Слишком много попыток. Попробуйте через минуту.');
});

test('anything else shows a general sentence with the server words underneath', () => {
  const failure = signInFailureText({ status: 500, message: 'Database error granting user' });

  expect(failure.text).toBe('Не удалось выполнить действие. Попробуйте ещё раз.');
  expect(failure.detail).toBe('Database error granting user');
});

test('a failure that is not an object at all does not crash the screen', () => {
  const failure = signInFailureText('boom');

  expect(failure.text.length).toBeGreaterThan(0);
});
