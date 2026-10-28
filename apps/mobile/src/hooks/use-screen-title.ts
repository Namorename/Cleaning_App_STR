import { useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * The header's title, set from the screen: while the screen is the one on
 * top, once per title, and never once it is on its way out.
 *
 * `<Stack.Screen options={{ title }}>` sets the options again on every draw,
 * and a screen that leaves by itself after a mutation goes on drawing as the
 * mutation's answers and the upload's percent come in. On Android a header
 * touched while its screen is being taken off the stack brings the app down
 * (react-native-screens: «ScreenStackFragment added into a non-stack
 * container»; Sentry 2026-10-09 and 10-10, docs/launch-phone-plan.md §9).
 * From `beforeRemove` — sent before the stack lets go of the screen — the
 * header is left alone; a screen covered by another waits, and says the
 * latest title when it is on top again.
 *
 * Not for a screen that guards against leaving: a removal it prevents would
 * still count as leaving here, and its title would stop following.
 */
export function useScreenTitle(title: string | undefined): void {
  const navigation = useNavigation();
  const isLeaving = useRef(false);
  const shown = useRef<string | undefined>(undefined);
  const wanted = useRef(title);

  const apply = useCallback(() => {
    const next = wanted.current;
    if (next === undefined || next === shown.current) {
      return;
    }
    if (isLeaving.current || !navigation.isFocused()) {
      return;
    }
    shown.current = next;
    navigation.setOptions({ title: next });
  }, [navigation]);

  useEffect(() => {
    const offRemove = navigation.addListener('beforeRemove', () => {
      isLeaving.current = true;
    });
    const offFocus = navigation.addListener('focus', apply);
    return () => {
      offRemove();
      offFocus();
    };
  }, [navigation, apply]);

  // Before the frame is drawn: the header never shows the route's file name.
  useLayoutEffect(() => {
    wanted.current = title;
    apply();
  }, [title, apply]);
}
