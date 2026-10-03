import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { reportError } from '@/lib/sentry';

/**
 * Whether the phone asks for less motion (iOS "Reduce Motion", Android
 * "Remove animations"). A component that animates — a pulse, a fade, a
 * sliding sheet — draws its end state at once when this is on.
 */
export function useReducedMotion(): boolean {
  const [isReduced, setIsReduced] = useState(false);

  useEffect(() => {
    let isMounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (isMounted) {
        setIsReduced(value);
      }
    }, reportError);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setIsReduced);
    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  return isReduced;
}
