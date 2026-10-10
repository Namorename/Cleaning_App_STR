import { render, screen } from '@testing-library/react-native';

import { i18n } from '@/i18n';

import { AboutSection } from '../about-section';
import { buildLine } from '../build-info';

/**
 * «О приложении» says which code the phone runs: the version, the update it
 * took over the air — or the build it was installed with — and the channel it
 * listens to. 10.10: two phones were thought not to have the night's update,
 * and only the crash reports could tell which one had it.
 */

const mockUpdates: { updateId: string | null; isEmbeddedLaunch: boolean; channel: string | null } =
  { updateId: null, isEmbeddedLaunch: true, channel: 'preview' };

jest.mock('expo-updates', () => ({
  __esModule: true,
  get updateId() {
    return mockUpdates.updateId;
  },
  get isEmbeddedLaunch() {
    return mockUpdates.isEmbeddedLaunch;
  },
  get channel() {
    return mockUpdates.channel;
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.2.0' } },
}));

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const OTA_ID = '01a12342-e50f-7617-9724-20d7193f5224';
const EMBEDDED_ID = 'eb115c0b-61bc-476d-aace-aca3d5f7fdaf';

beforeEach(() => {
  mockUpdates.updateId = EMBEDDED_ID;
  mockUpdates.isEmbeddedLaunch = true;
  mockUpdates.channel = 'preview';
});

test('a phone on the build it was installed with says so', async () => {
  await render(<AboutSection />);

  expect(screen.getByText('1.2.0 · встроенная сборка · канал preview')).toBeTruthy();
});

test('a phone on an update names the first eight characters of its id', async () => {
  mockUpdates.updateId = OTA_ID;
  mockUpdates.isEmbeddedLaunch = false;

  await render(<AboutSection />);

  expect(screen.getByText('1.2.0 · обновление 01a12342 · канал preview')).toBeTruthy();
});

test('a build without updates names no channel', async () => {
  mockUpdates.updateId = null;
  mockUpdates.channel = null;

  await render(<AboutSection />);

  expect(screen.getByText('1.2.0 · встроенная сборка')).toBeTruthy();
});

test.each([
  ['en', '1.2.0 · update 01a12342 · channel preview', '1.2.0 · built-in bundle · channel field'],
  ['cs', '1.2.0 · aktualizace 01a12342 · kanál preview', '1.2.0 · vestavěná sestava · kanál field'],
])('in %s too', async (language, onUpdate, onBuild) => {
  const t = i18n.getFixedT(language);

  expect(buildLine({ version: '1.2.0', updateId: OTA_ID, channel: 'preview' }, t)).toBe(onUpdate);
  expect(buildLine({ version: '1.2.0', updateId: null, channel: 'field' }, t)).toBe(onBuild);
});
