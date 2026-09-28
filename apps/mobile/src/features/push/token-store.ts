import * as SecureStore from 'expo-secure-store';

/**
 * The Expo token this phone last registered, kept for signing out.
 *
 * Signing out must not ask Expo for the token again — that is a request to
 * Expo's servers and fails without signal — so the one that was registered
 * is kept on the phone. In the Keychain rather than AsyncStorage: anyone
 * holding it can send this phone a push.
 */
const TOKEN_KEY = 'push-token';

/** Who the phone was registered for in this run, so coming back to the app does not ask again. */
let registeredFor: string | null = null;

/** Sign-outs in this run: a registration begun before one must not land after it. */
let signOuts = 0;

export function signOutsSoFar(): number {
  return signOuts;
}

export async function rememberRegistration(token: string, registrant: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  registeredFor = registrant;
}

export function isRegisteredFor(registrant: string): boolean {
  return registeredFor === registrant;
}

export async function rememberedToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

/** On sign-out: the next person, or she herself signing back in, registers afresh. */
export async function forgetRegistration(): Promise<void> {
  signOuts += 1;
  registeredFor = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
