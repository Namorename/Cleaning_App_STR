// The app's entry. What must run before the first screen is drawn — crash
// reports, the handler that shows a push while the app is open — comes first;
// the router, which draws the screens, always last.
import './src/boot';
import 'expo-router/entry';
