import * as SecureStore from 'expo-secure-store';

/**
 * The Expo token this phone registered, kept for signing out, and what this
 * run knows about the registration.
 *
 * Signing out must not ask Expo for the token again — that is a request to
 * Expo's servers and fails without signal — so the one that was registered
 * is kept on the phone. In the Keychain rather than AsyncStorage: anyone
 * holding it can send this phone a push. It is written before the server
 * hears of it: a sign-out while that call is on its way must find something
 * to let go of (docs/f11-native-review.md, Т-1).
 */
const TOKEN_KEY = 'push-token';

/** Who the phone was registered for in this run, so coming back to the app does not ask again. */
let registeredFor: string | null = null;

/** Sign-outs in this run: a registration begun before one must not land after it. */
let signOuts = 0;

/** The registration on its way, if any: the explainer and the hook share it, sign-out waits for it. */
let onItsWay: { registrant: string; registration: Promise<boolean> } | null = null;

export function signOutsSoFar(): number {
  return signOuts;
}

export async function rememberToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/** The server has the phone for her: coming back to the app asks nothing more in this run. */
export function markRegistered(registrant: string): void {
  registeredFor = registrant;
}

/** The server let go of the phone while she stayed signed in: the next chance registers it again. */
export function unmarkRegistered(): void {
  registeredFor = null;
}

export function isRegisteredFor(registrant: string): boolean {
  return registeredFor === registrant;
}

/** Whom the phone is registered for in this run, if anyone. */
export function registrant(): string | null {
  return registeredFor;
}

export async function rememberedToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export function trackRegistration(person: string, registration: Promise<boolean>): void {
  const entry = { registrant: person, registration };
  onItsWay = entry;
  const done = () => {
    if (onItsWay === entry) {
      onItsWay = null;
    }
  };
  registration.then(done, done);
}

/** The registration on its way — for this person only, when one is named. */
export function registrationOnItsWay(person?: string): Promise<boolean> | null {
  if (onItsWay === null || (person !== undefined && onItsWay.registrant !== person)) {
    return null;
  }
  return onItsWay.registration;
}

/** Once she is out: the next person, or she herself signing back in, registers afresh. */
export async function forgetRegistration(): Promise<void> {
  signOuts += 1;
  registeredFor = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
