import * as Sentry from '@sentry/react-native';
import { render, screen } from '@testing-library/react-native';

import { PhotoViewerHost } from '../photo-viewer-host';

/**
 * The viewer's module loads on the first tap, not at start: it brings the
 * gesture handler and Reanimated, which no screen ran before. Should either
 * fail to load on a phone, the tap reports it and does nothing — the app
 * goes on, and a second tap does not report it again.
 */

jest.mock('../photo-viewer', () => {
  throw new Error('Native part of Reanimated is missing');
});

const items = [{ id: 'p1', kind: 'photo' as const, uri: 'file:///kept/p1.jpg', number: 1 }];

test('a viewer that will not load is reported once, and closes at once', async () => {
  const onClose = jest.fn();

  await render(<PhotoViewerHost items={items} total={1} openId="p1" onClose={onClose} />);

  expect(screen.queryByTestId('photo-viewer')).toBeNull();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Native part of Reanimated is missing' }),
  );

  await render(<PhotoViewerHost items={items} total={1} openId="p1" onClose={onClose} />);

  expect(onClose).toHaveBeenCalledTimes(2);
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
});
