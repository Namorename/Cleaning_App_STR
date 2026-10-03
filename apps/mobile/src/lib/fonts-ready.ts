import { createContext, useContext } from 'react';

/**
 * Whether the app's font is loaded, from the root layout down.
 *
 * False until Nunito has loaded, and false for good if it failed to: the app
 * then carries on in the system font rather than waiting on the splash, and
 * the text component draws weights the system's way. Outside any provider —
 * a component test — it is false as well.
 */
const FontsReadyContext = createContext(false);

export const FontsReadyProvider = FontsReadyContext.Provider;

export function useFontsReady(): boolean {
  return useContext(FontsReadyContext);
}
