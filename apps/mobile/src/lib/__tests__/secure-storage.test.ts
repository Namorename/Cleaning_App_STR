import * as SecureStore from 'expo-secure-store';

import { sessionStorage } from '../secure-storage';

describe('sessionStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns null for a key that was never written', async () => {
    await expect(sessionStorage.getItem('sb-missing')).resolves.toBeNull();
  });

  test('round-trips a value that fits in one chunk', async () => {
    await sessionStorage.setItem('sb-auth', 'small-session');

    await expect(sessionStorage.getItem('sb-auth')).resolves.toBe('small-session');
  });

  test('round-trips a session larger than the SecureStore item limit', async () => {
    // Arrange: Android refuses values over 2048 bytes, and a real session with
    // a JWT lands well past that.
    const session = 'x'.repeat(5000);

    // Act
    await sessionStorage.setItem('sb-auth', session);

    // Assert
    await expect(sessionStorage.getItem('sb-auth')).resolves.toBe(session);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('sb-auth__0', expect.any(String));
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('sb-auth__2', expect.any(String));
  });

  test('leaves no orphan chunks when a long session is replaced by a short one', async () => {
    await sessionStorage.setItem('sb-auth', 'y'.repeat(5000));

    await sessionStorage.setItem('sb-auth', 'short');

    await expect(sessionStorage.getItem('sb-auth')).resolves.toBe('short');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('sb-auth__2');
  });

  test('treats a half-written session as absent rather than returning a broken token', async () => {
    await sessionStorage.setItem('sb-auth', 'z'.repeat(5000));
    await SecureStore.deleteItemAsync('sb-auth__1');

    await expect(sessionStorage.getItem('sb-auth')).resolves.toBeNull();
  });

  test('removes every chunk on sign-out', async () => {
    await sessionStorage.setItem('sb-auth', 'w'.repeat(5000));

    await sessionStorage.removeItem('sb-auth');

    await expect(sessionStorage.getItem('sb-auth')).resolves.toBeNull();
  });
});
