import { describe, expect, test } from 'vitest';

import { fetchProperty, savePropertyInfo } from '../api';
import type { InfoDraft } from '../schema';

/**
 * The office's note on a listing, since it left the property row.
 *
 * `properties.internal_notes` reached every cleaner who could read the row, so
 * the note moved to `property_internal_notes`, which only a manager reads
 * (docs/window3-plan.md, «А»). The card still shows and saves it as before —
 * what changes is that it is two tables now, and nothing in `tsc` notices a
 * read or a write that forgot the second one.
 */

interface Call {
  table: string;
  op: 'select' | 'update' | 'upsert' | 'delete' | 'none';
  select?: string;
  payload?: unknown;
  options?: unknown;
  filters: [string, unknown][];
}

type Answer = { data: unknown; error: unknown };

function fakeClient(answers: Record<string, Answer>) {
  const calls: Call[] = [];

  const from = (table: string) => {
    const call: Call = { table, op: 'none', filters: [] };
    calls.push(call);
    const result = Promise.resolve(answers[table] ?? { data: null, error: null });
    const self: Record<string, unknown> = {
      then: result.then.bind(result),
      catch: result.catch.bind(result),
      finally: result.finally.bind(result),
    };
    self.select = (columns: string) => {
      call.op = call.op === 'none' ? 'select' : call.op;
      call.select = columns;
      return self;
    };
    self.update = (payload: unknown) => {
      call.op = 'update';
      call.payload = payload;
      return self;
    };
    self.upsert = (payload: unknown, options: unknown) => {
      call.op = 'upsert';
      call.payload = payload;
      call.options = options;
      return self;
    };
    self.delete = () => {
      call.op = 'delete';
      return self;
    };
    self.eq = (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return self;
    };
    self.maybeSingle = () => self;
    return self;
  };

  // The functions are typed against the real client; this is all they touch.
  return { client: { from } as never, calls };
}

const ROW = {
  id: 7,
  name: 'Brehova 208',
  address: 'Brehova 208',
  city: 'Praha 1',
  status: 'active',
  parent_id: null,
  bedrooms: 2,
  max_guests: 4,
  country_code: 'CZ',
  timezone: 'Europe/Prague',
  bathrooms: 1,
  check_in_time: '15:00',
  check_out_time: '10:00',
  cleaner_notes: 'Key in box 4325',
  synced_at: null,
};

const DRAFT: InfoDraft = { parentId: null, cleanerNotes: ' Key in box 4325 ', internalNotes: '' };

describe('reading a listing', () => {
  test('brings the office note from its own table into the card', async () => {
    const { client } = fakeClient({
      properties: { data: ROW, error: null },
      property_internal_notes: { data: { notes: 'Owner is picky' }, error: null },
    });

    const property = await fetchProperty(client, 7);

    expect(property?.internal_notes).toBe('Owner is picky');
    expect(property?.cleaner_notes).toBe('Key in box 4325');
  });

  test('a listing without a note has none', async () => {
    const { client } = fakeClient({
      properties: { data: ROW, error: null },
      property_internal_notes: { data: null, error: null },
    });

    expect((await fetchProperty(client, 7))?.internal_notes).toBeNull();
  });

  test('never asks the property row for the note', async () => {
    const { client, calls } = fakeClient({
      properties: { data: ROW, error: null },
      property_internal_notes: { data: null, error: null },
    });

    await fetchProperty(client, 7);

    const row = calls.find((call) => call.table === 'properties');
    expect(row?.select).not.toContain('internal_notes');
    expect(calls.find((call) => call.table === 'property_internal_notes')?.filters).toEqual([
      ['property_id', 7],
    ]);
  });

  test('a listing that is not there is not there, note or no note', async () => {
    const { client } = fakeClient({
      properties: { data: null, error: null },
      property_internal_notes: { data: null, error: null },
    });

    expect(await fetchProperty(client, 7)).toBeNull();
  });

  test('a refused note read is an error, not an empty note', async () => {
    const refusal = { code: '42501', message: 'permission denied' };
    const { client } = fakeClient({
      properties: { data: ROW, error: null },
      property_internal_notes: { data: null, error: refusal },
    });

    await expect(fetchProperty(client, 7)).rejects.toBe(refusal);
  });
});

describe('saving a listing', () => {
  test('writes the parent and the cleaner note to the row, and not the office note', async () => {
    const { client, calls } = fakeClient({});

    await savePropertyInfo(client, 7, { ...DRAFT, internalNotes: 'Owner is picky' });

    const row = calls.find((call) => call.table === 'properties');
    expect(row?.op).toBe('update');
    expect(row?.payload).toEqual({ parent_id: null, cleaner_notes: 'Key in box 4325' });
    expect(row?.filters).toEqual([['id', 7]]);
  });

  test('keeps the office note in its own table, one row per listing', async () => {
    const { client, calls } = fakeClient({});

    await savePropertyInfo(client, 7, { ...DRAFT, internalNotes: '  Owner is picky ' });

    const note = calls.find((call) => call.table === 'property_internal_notes');
    expect(note?.op).toBe('upsert');
    expect(note?.payload).toEqual({ property_id: 7, notes: 'Owner is picky' });
    expect(note?.options).toEqual({ onConflict: 'property_id' });
  });

  // The table refuses a blank note: an emptied box means "no note", which is
  // no row at all.
  test('an emptied note removes the row', async () => {
    const { client, calls } = fakeClient({});

    await savePropertyInfo(client, 7, { ...DRAFT, internalNotes: '   ' });

    const note = calls.find((call) => call.table === 'property_internal_notes');
    expect(note?.op).toBe('delete');
    expect(note?.filters).toEqual([['property_id', 7]]);
  });

  // The row goes first: a parent the hierarchy refuses stops the save before
  // anything is written, and the manager sees one error for one attempt.
  test('a refused row write leaves the note alone', async () => {
    const refusal = { code: '23514', message: 'propertyIsUnit' };
    const { client, calls } = fakeClient({ properties: { data: null, error: refusal } });

    await expect(
      savePropertyInfo(client, 7, { ...DRAFT, internalNotes: 'Owner is picky' }),
    ).rejects.toBe(refusal);
    expect(calls.some((call) => call.table === 'property_internal_notes')).toBe(false);
  });

  test('a refused note write is reported', async () => {
    const refusal = { code: '42501', message: 'permission denied' };
    const { client } = fakeClient({ property_internal_notes: { data: null, error: refusal } });

    await expect(
      savePropertyInfo(client, 7, { ...DRAFT, internalNotes: 'Owner is picky' }),
    ).rejects.toBe(refusal);
  });
});
