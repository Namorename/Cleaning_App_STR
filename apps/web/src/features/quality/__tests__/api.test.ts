import { describe, expect, it, vi } from 'vitest';

import { fetchQualityAreas, fetchQualityOverview, fetchQualityPlace } from '../api';
import { cardOf, overviewOfRows, placeOf, themeOf } from './fixtures';

function clientAnswering(data: unknown, error: unknown = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { client: { rpc } as unknown as Parameters<typeof fetchQualityOverview>[0], rpc };
}

const OVERVIEW = overviewOfRows([placeOf()], [themeOf({ reviews: 1 })]);

describe('fetchQualityOverview', () => {
  it('asks for the window and hands the answer over', async () => {
    const { client, rpc } = clientAnswering(OVERVIEW);

    await expect(fetchQualityOverview(client, '3m')).resolves.toEqual(OVERVIEW);
    expect(rpc).toHaveBeenCalledWith('quality_overview', { p_window: '3m' });
  });

  it('takes a place nobody rated', async () => {
    const data = overviewOfRows([placeOf({ rating_n: 0, rating_avg: null })], []);
    const { client } = clientAnswering(data);

    const read = await fetchQualityOverview(client, '12m');

    expect(read.places[0].rating_avg).toBeNull();
  });

  it('drops a theme this build does not know and keeps the rest', async () => {
    const data = {
      ...OVERVIEW,
      themes: [...OVERVIEW.themes, { ...themeOf({ reviews: 5 }), theme: 'teleport' }],
    };
    const { client } = clientAnswering(data);

    const read = await fetchQualityOverview(client, '12m');

    expect(read.themes.map((row) => row.theme)).toEqual(['wifi']);
  });

  it('does not take the name of an object’s own property for a theme', async () => {
    const data = { ...OVERVIEW, themes: [{ ...themeOf({ reviews: 5 }), theme: 'constructor' }] };
    const { client } = clientAnswering(data);

    expect((await fetchQualityOverview(client, '12m')).themes).toEqual([]);
  });

  it('refuses a figure it cannot read rather than show a silent zero', async () => {
    const data = { ...OVERVIEW, places: [{ ...placeOf(), stays: 'many' }] };
    const { client } = clientAnswering(data);

    await expect(fetchQualityOverview(client, '12m')).rejects.toThrow();
  });

  it('says a wrong shape in plain words, not as a dump of every path', async () => {
    const data = { ...OVERVIEW, places: [{ ...placeOf(), stays: 'many' }] };
    const { client } = clientAnswering(data);

    const failure: unknown = await fetchQualityOverview(client, '12m').catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('The answer has an unexpected shape');
  });

  it('takes an answer with neither bookings held nor a line', async () => {
    const data = { ...OVERVIEW, held_from: null, line: null };
    const { client } = clientAnswering(data);

    const read = await fetchQualityOverview(client, '12m');

    expect(read).toMatchObject({ held_from: null, line: null });
  });

  it('hands a refusal over as it came', async () => {
    const refusal = {
      message: 'A quality window is one of',
      hint: 'serverErrors.qualityWindowInvalid',
    };
    const { client } = clientAnswering(null, refusal);

    await expect(fetchQualityOverview(client, '12m')).rejects.toBe(refusal);
  });
});

describe('fetchQualityAreas', () => {
  const member = {
    theme: 'wifi',
    property_id: 7,
    name: 'Old Town flat',
    basis: 'guest',
    episodes: 3,
    stays: 40,
  };

  it('asks for the window and hands the answer over', async () => {
    const answer = { window: '3m', computed_on: '2026-11-05', members: [member] };
    const { client, rpc } = clientAnswering(answer);

    await expect(fetchQualityAreas(client, '3m')).resolves.toEqual(answer);
    expect(rpc).toHaveBeenCalledWith('quality_areas', { p_window: '3m' });
  });

  it('takes a night that has not come yet', async () => {
    const { client } = clientAnswering({ window: '12m', computed_on: null, members: [] });

    await expect(fetchQualityAreas(client, '12m')).resolves.toMatchObject({ computed_on: null });
  });

  it('drops a theme this build does not know and keeps the rest', async () => {
    const { client } = clientAnswering({
      window: '12m',
      computed_on: '2026-11-05',
      members: [member, { ...member, theme: 'teleport' }],
    });

    const read = await fetchQualityAreas(client, '12m');

    expect(read.members.map((row) => row.theme)).toEqual(['wifi']);
  });

  it('says a wrong shape in plain words, not as a dump of every path', async () => {
    const { client } = clientAnswering({
      window: '12m',
      computed_on: '2026-11-05',
      members: [{ ...member, basis: 'owner' }],
    });

    await expect(fetchQualityAreas(client, '12m')).rejects.toThrow(
      /^The answer has an unexpected shape$/,
    );
  });

  it('hands a refusal over as it came', async () => {
    const refusal = { message: 'Property quality is for managers only' };
    const { client } = clientAnswering(null, refusal);

    await expect(fetchQualityAreas(client, '12m')).rejects.toBe(refusal);
  });
});

describe('fetchQualityPlace', () => {
  it('asks for the place in the window', async () => {
    const card = cardOf();
    const { client, rpc } = clientAnswering(card);

    await expect(fetchQualityPlace(client, 7, '6m')).resolves.toEqual(card);
    expect(rpc).toHaveBeenCalledWith('quality_place', { p_property_id: 7, p_window: '6m' });
  });

  it('answers null for a place the company has not got', async () => {
    const { client } = clientAnswering(null);

    await expect(fetchQualityPlace(client, 7, '12m')).resolves.toBeNull();
  });

  it('says a wrong shape in plain words here too', async () => {
    const { client } = clientAnswering({ ...cardOf(), place: { name: 'Old Town flat' } });

    await expect(fetchQualityPlace(client, 7, '12m')).rejects.toThrow(
      /^The answer has an unexpected shape$/,
    );
  });

  it('drops what this build cannot name, in every list', async () => {
    const data = {
      ...cardOf(),
      themes: [{ ...themeOf({ reviews: 1 }), theme: 'teleport' }],
      months: [
        { month: '2026-10-01', theme: 'teleport', layer: 'guest_review', n: 1 },
        { month: '2026-10-01', theme: 'wifi', layer: 'guest_message', n: 1 },
        { month: '2026-10-01', theme: 'wifi', layer: 'guest_review', n: 2 },
      ],
      categories: [
        { key: 'scent', n: 1, average: 9, peers_n: 0, peers_average: null },
        { key: 'cleanliness', n: 1, average: 9, peers_n: 0, peers_average: null },
      ],
    };
    const { client } = clientAnswering(data);

    const read = await fetchQualityPlace(client, 7, '12m');

    expect(read?.themes).toEqual([]);
    expect(read?.months).toEqual([
      { month: '2026-10-01', theme: 'wifi', layer: 'guest_review', n: 2 },
    ]);
    expect(read?.categories.map((category) => category.key)).toEqual(['cleanliness']);
  });
});
