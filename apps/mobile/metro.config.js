// Expo's own Metro config — including its monorepo detection, which is how
// @str-ops/shared resolves — with Sentry's serializer on top: every bundle
// carries a debug id, so a crash from the field maps back to the source.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
