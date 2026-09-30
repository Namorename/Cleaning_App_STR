// The app's entry. Imports run in order: crash reports first, so whatever
// fails after them — the app's configuration included — is reported; then the
// handler that shows a push while the app is open; the router, which draws the
// screens, always last.
import './src/crash-reports';
import './src/boot';
import 'expo-router/entry';
