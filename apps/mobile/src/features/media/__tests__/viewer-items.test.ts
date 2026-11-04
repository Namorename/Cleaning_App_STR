import { viewerItemsOf } from '../viewer-items';

/**
 * What a row hands the viewer: the files there is something to draw from,
 * numbered as the row numbers its tiles, so «Фото 3 из 4» is the third tile
 * even when the second had nothing to show.
 */

test('keeps the files with a source, in order, numbered by their tile', () => {
  const items = viewerItemsOf([
    { id: 'a', uri: 'file:///a.jpg' },
    { id: 'b', uri: null },
    { id: 'c', uri: 'https://x.example/c.jpg' },
  ]);

  expect(items).toEqual([
    { id: 'a', kind: 'photo', uri: 'file:///a.jpg', number: 1 },
    { id: 'c', kind: 'photo', uri: 'https://x.example/c.jpg', number: 3 },
  ]);
});

test('a video stays a video', () => {
  expect(viewerItemsOf([{ id: 'v', uri: 'file:///v.mp4', kind: 'video' }])).toEqual([
    { id: 'v', kind: 'video', uri: 'file:///v.mp4', number: 1 },
  ]);
});

test('a row with nothing to draw from opens nothing', () => {
  expect(viewerItemsOf([{ id: 'a', uri: null }])).toEqual([]);
});
