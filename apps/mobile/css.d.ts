// Expo's web build resolves CSS imports through Metro; TypeScript needs to be
// told they exist and carry no exports.
declare module '*.css';
