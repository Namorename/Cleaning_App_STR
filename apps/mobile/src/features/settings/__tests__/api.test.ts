import { fetchMyPushPreferences, saveMyLanguage, setPushPreference } from '../api';

const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** `from(table).select(columns).eq(column, value).maybeSingle()`, answering `result`. */
function readAnswering(result: { data: unknown; error: unknown }) {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  mockFrom.mockReturnValue({ select });
  return { select, eq, maybeSingle };
}

/** `from(table).update(values).eq(column, value).select(columns).maybeSingle()`. */
function updateAnswering(result: { data: unknown; error: unknown }) {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const select = jest.fn(() => ({ maybeSingle }));
  const eq = jest.fn(() => ({ select }));
  const update = jest.fn(() => ({ eq }));
  mockFrom.mockReturnValue({ update });
  return { update, eq, select, maybeSingle };
}

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

describe('fetchMyPushPreferences', () => {
  test('asks for her own row by id', async () => {
    // Arrange
    const read = readAnswering({ data: { profile_id: ME, muted: ['daily_digest'] }, error: null });

    // Act
    const row = await fetchMyPushPreferences(ME);

    // Assert
    expect(mockFrom).toHaveBeenCalledWith('push_preferences');
    expect(read.select).toHaveBeenCalledWith('profile_id, muted');
    expect(read.eq).toHaveBeenCalledWith('profile_id', ME);
    expect(row).toEqual({ profile_id: ME, muted: ['daily_digest'] });
  });

  test('no row means she never switched anything off', async () => {
    readAnswering({ data: null, error: null });

    await expect(fetchMyPushPreferences(ME)).resolves.toBeNull();
  });

  test('a kind added by a newer server is dropped rather than failing the read', async () => {
    readAnswering({ data: { profile_id: ME, muted: ['cleaning_teleported'] }, error: null });

    await expect(fetchMyPushPreferences(ME)).resolves.toEqual({ profile_id: ME, muted: [] });
  });

  test('a refusal is thrown as it came', async () => {
    const refusal = { message: 'permission denied for table push_preferences', code: '42501' };
    readAnswering({ data: null, error: refusal });

    await expect(fetchMyPushPreferences(ME)).rejects.toBe(refusal);
  });
});

describe('setPushPreference', () => {
  test('sends the wanted value, not a toggle, and reads back her row', async () => {
    // Arrange
    mockRpc.mockResolvedValue({
      data: {
        profile_id: ME,
        host_id: 'a1b2c3d4-1111-4111-8111-a1b2c3d40001',
        muted: ['chat_message'],
        updated_at: '2026-09-28T10:00:00+00:00',
      },
      error: null,
    });

    // Act
    const row = await setPushPreference('chat_message', false);

    // Assert
    expect(mockRpc).toHaveBeenCalledWith('set_push_preference', {
      p_kind: 'chat_message',
      p_enabled: false,
    });
    expect(row).toEqual({ profile_id: ME, muted: ['chat_message'] });
  });

  test('a refusal is thrown as it came, for the screen to translate', async () => {
    const refusal = {
      message: 'Only an active person can change her pushes',
      hint: 'serverErrors.notSignedIn',
    };
    mockRpc.mockResolvedValue({ data: null, error: refusal });

    await expect(setPushPreference('daily_digest', true)).rejects.toBe(refusal);
  });
});

describe('saveMyLanguage', () => {
  test('writes her own row and nobody else’s', async () => {
    // Arrange
    const write = updateAnswering({ data: { id: ME }, error: null });

    // Act
    await saveMyLanguage(ME, 'cs');

    // Assert
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(write.update).toHaveBeenCalledWith({ preferred_language: 'cs' });
    expect(write.eq).toHaveBeenCalledWith('id', ME);
  });

  test('an update that reached no row is a failure, not a silent success', async () => {
    updateAnswering({ data: null, error: null });

    await expect(saveMyLanguage(ME, 'en')).rejects.toThrow('Own profile row was not updated');
  });

  test('a refusal is thrown as it came', async () => {
    const refusal = { message: 'invalid input value for enum app_language', code: '22P02' };
    updateAnswering({ data: null, error: refusal });

    await expect(saveMyLanguage(ME, 'en')).rejects.toBe(refusal);
  });
});
