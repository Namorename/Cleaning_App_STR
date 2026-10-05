/**
 * The panel's text searches: case and diacritics do not count, every word
 * typed has to be found, in any order. The rule moved to `packages/shared`
 * when the phone's choice of a place started searching too, so the two apps
 * cannot drift apart; the tests stay here (`__tests__/search.test.ts`).
 */
export { foldForSearch, matchesAllTokens } from '@str-ops/shared';
