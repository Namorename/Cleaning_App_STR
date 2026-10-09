/**
 * A PNG in the bundle: the bundler turns its import into a reference React
 * Native's `Image` draws from, choosing `@2x`/`@3x` by the screen's density.
 */
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';

  const source: ImageSourcePropType;
  export default source;
}
