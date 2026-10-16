import { describe, expect, test, vi } from 'vitest';

import { fetchHostSettings, saveHostSettings } from '../api';

/**
 * What the company settings send and ask for.
 *
 * `update_host_settings` reads a missing argument as "not part of this call"
 * (20261003170000): the video numbers must not carry an answer about the two
 * switches, and a switch must not carry one about the video.
 */

function rpcClient() {
  const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return { client: { rpc } as never, rpc };
}

describe('saveHostSettings', () => {
  test('sends the three video numbers and leaves the switches out', async () => {
    const { client, rpc } = rpcClient();

    await saveHostSettings(client, { videoMaxSec: 90, videoBitrateKbps: 2000, videoMaxMb: 45 });

    expect(rpc).toHaveBeenCalledWith('update_host_settings', {
      p_video_max_sec: 90,
      p_video_bitrate_kbps: 2000,
      p_video_max_mb: 45,
    });
  });

  test('a switch still sends only itself', async () => {
    const { client, rpc } = rpcClient();

    await saveHostSettings(client, { galleryAllowed: true });

    expect(rpc).toHaveBeenCalledWith('update_host_settings', { p_gallery_allowed: true });
  });

  // `toHaveBeenCalledWith` takes a key set to undefined for a key left out.
  // The keys are the contract — a missing one means "leave it alone" — so
  // they are compared as they are.
  test.each([
    [
      { videoMaxSec: 90, videoBitrateKbps: 2000, videoMaxMb: 45 },
      ['p_video_max_sec', 'p_video_bitrate_kbps', 'p_video_max_mb'],
    ],
    [{ galleryAllowed: false }, ['p_gallery_allowed']],
    [{ parallelStartAllowed: true }, ['p_parallel_start_allowed']],
  ])('sends exactly the keys of the patch %o', async (patch, keys) => {
    const { client, rpc } = rpcClient();

    await saveHostSettings(client, patch);

    const [, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(Object.keys(args).sort()).toEqual([...keys].sort());
  });

  test('a refusal is thrown as the server sent it, for serverErrorText to read', async () => {
    const refusal = { message: 'x', hint: 'serverErrors.videoSettingOutOfRange', details: '{}' };
    const client = { rpc: () => Promise.resolve({ data: null, error: refusal }) } as never;

    await expect(saveHostSettings(client, { videoMaxSec: 5 })).rejects.toBe(refusal);
  });
});

describe('fetchHostSettings', () => {
  test('reads the three video numbers with the switches', async () => {
    const selects: string[] = [];
    const row = {
      id: 'h1',
      name: 'Primary host',
      parallel_start_allowed: false,
      gallery_allowed: false,
      video_max_sec: 120,
      video_bitrate_kbps: 2000,
      video_max_mb: 45,
    };
    const builder = {
      select: (columns: string) => {
        selects.push(columns);
        return builder;
      },
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: row, error: null }),
    };
    const client = { from: () => builder } as never;

    const host = await fetchHostSettings(client);

    const columns = selects[0].split(',').map((column) => column.trim());
    expect(columns).toEqual(
      expect.arrayContaining(['video_max_sec', 'video_bitrate_kbps', 'video_max_mb']),
    );
    expect(host).toEqual(row);
  });
});
