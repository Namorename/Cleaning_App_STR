import { messageTiles, type OwnMediaStates } from '../media-tiles';
import type { ChatMessageMedia } from '../schema';

const MESSAGE = '44444444-4444-4444-8444-444444444444';

function row(id: string, uploaded: boolean): ChatMessageMedia {
  return {
    id,
    storage_path: `host/chat/thread/${id}.jpg`,
    uploaded_at: uploaded ? '2026-09-18T10:00:05+00:00' : null,
    created_at: '2026-09-18T10:00:01+00:00',
  };
}

const local = {
  m2: {
    id: 'm2',
    kind: 'photo' as const,
    uri: 'file:///kept/m2.jpg',
    mimeType: 'image/jpeg',
    byteSize: 100,
    width: null,
    height: null,
    durationSec: null,
    takenAt: '2026-09-18T10:00:00+00:00',
  },
};

const NONE: OwnMediaStates = new Map();

test('the receiver sees a picture where the file arrived and a hole where it did not', () => {
  const tiles = messageTiles(
    MESSAGE,
    'Смотри',
    [row('m1', true), row('m2', false)],
    false,
    NONE,
    {},
    { 'host/chat/thread/m1.jpg': 'https://signed/m1' },
    false,
  );

  expect(tiles).toEqual([
    { id: 'm1', uri: 'https://signed/m1', status: 'uploaded', canRemove: true },
    { id: 'm2', uri: null, status: 'awaited', canRemove: true },
  ]);
});

test('the sender sees her own queue: travelling, failed, expired', () => {
  const own: OwnMediaStates = new Map([
    ['m2', { messageId: MESSAGE, status: 'uploading' }],
    ['m3', { messageId: MESSAGE, status: 'expired' }],
    ['m9', { messageId: 'other', status: 'uploading' }],
  ]);

  const tiles = messageTiles(
    MESSAGE,
    '',
    [row('m1', false), row('m2', false)],
    true,
    own,
    local,
    {},
    false,
  );

  expect(tiles).toEqual([
    // A row without a file and nothing in the queue for it: stranded.
    { id: 'm1', uri: null, status: 'failed', canRemove: true },
    // Registered and still travelling, shown from the file on the phone.
    { id: 'm2', uri: 'file:///kept/m2.jpg', status: 'uploading', canRemove: true },
    // Not registered at all, but this phone knows about it.
    { id: 'm3', uri: null, status: 'expired', canRemove: true },
  ]);
});

test('the hole is drawn by the row, never by the declaration', () => {
  // The message declared photos; none is registered; the reader sees no tiles.
  expect(messageTiles(MESSAGE, 'Только текст', [], false, NONE, {}, {}, false)).toEqual([]);
});

test('a message with no words and no rows shows one grey tile, by the empty text', () => {
  expect(messageTiles(MESSAGE, '  ', [], false, NONE, {}, {}, false)).toEqual([
    { id: `${MESSAGE}:awaited`, uri: null, status: 'awaited', canRemove: false },
  ]);
});

test('past the upload window the hole stops promising a photo that is not coming', () => {
  expect(messageTiles(MESSAGE, 'Смотри', [row('m2', false)], false, NONE, {}, {}, true)).toEqual([
    { id: 'm2', uri: null, status: 'expired', canRemove: true },
  ]);
});

test('and the placeholder of a wordless message says so, with nothing to remove', () => {
  // The photos were swept: no row is left to draw, the id belongs to nothing,
  // and «on its way» here would be a promise kept for ever.
  expect(messageTiles(MESSAGE, '', [], false, NONE, {}, {}, true)).toEqual([
    { id: `${MESSAGE}:expired`, uri: null, status: 'expired', canRemove: false },
  ]);
});

test('the sender keeps her own verdict, which is the more precise one', () => {
  const own: OwnMediaStates = new Map([['m2', { messageId: MESSAGE, status: 'uploading' }]]);

  expect(messageTiles(MESSAGE, '', [row('m2', false)], true, own, local, {}, true)).toEqual([
    { id: 'm2', uri: 'file:///kept/m2.jpg', status: 'uploading', canRemove: true },
  ]);
});
