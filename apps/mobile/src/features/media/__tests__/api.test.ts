import { addMedia, fetchTaskMedia, signedMediaUrls, uploadMediaFile } from '../api';

const mockRpc = jest.fn();
const mockUpload = jest.fn();
const mockCreateSignedUrls = jest.fn();
const listResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: () => Promise.resolve(listResponse),
          }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => mockUpload(...args),
        createSignedUrls: (...args: unknown[]) => mockCreateSignedUrls(...args),
      }),
    },
  },
}));

jest.mock('../file', () => ({
  readFileBytes: jest.fn(async () => new ArrayBuffer(8)),
}));

const row = {
  id: 'e6000001-0000-4000-8000-000000000001',
  task_id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
  step_id: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001',
  kind: 'photo',
  storage_path: 'host/task/e6000001-0000-4000-8000-000000000001.jpg',
  mime_type: 'image/jpeg',
  duration_sec: null,
  device_taken_at: '2026-09-07T10:00:00+00:00',
  created_at: '2026-09-07T10:00:01+00:00',
  uploaded_at: null,
  deleted_at: null,
  // Columns the function returns that the app does not read.
  host_id: 'a0000000-0000-4000-8000-00000000000a',
  byte_size: 123456,
  width: 1600,
  height: 1200,
  created_by: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  purged_at: null,
};

const variables = {
  mediaId: row.id,
  stepId: row.step_id,
  kind: 'photo' as const,
  mimeType: 'image/jpeg',
  byteSize: 123456,
  width: 1600,
  height: 1200,
  durationSec: null,
  takenAt: '2026-09-07T10:00:00+00:00',
};

beforeEach(() => {
  mockRpc.mockReset();
  mockUpload.mockReset();
  mockCreateSignedUrls.mockReset();
  listResponse.data = null;
  listResponse.error = null;
});

describe('addMedia', () => {
  test('registers the file with what the phone knows about it', async () => {
    mockRpc.mockResolvedValue({ data: row, error: null });

    const registered = await addMedia(variables);

    expect(mockRpc).toHaveBeenCalledWith('add_task_media', {
      p_id: row.id,
      p_step_id: row.step_id,
      p_kind: 'photo',
      p_mime_type: 'image/jpeg',
      p_byte_size: 123456,
      p_width: 1600,
      p_height: 1200,
      p_duration_sec: undefined,
      p_device_taken_at: '2026-09-07T10:00:00+00:00',
    });
    expect(registered.storage_path).toBe(row.storage_path);
  });

  test('surfaces the server refusal with its key', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'The step already holds 2 of at most 2 files',
        hint: 'serverErrors.mediaLimitReached',
      },
    });

    await expect(addMedia(variables)).rejects.toMatchObject({
      hint: 'serverErrors.mediaLimitReached',
    });
  });
});

describe('uploadMediaFile', () => {
  test('puts the bytes on the assigned path without overwriting', async () => {
    mockUpload.mockResolvedValue({ data: { path: row.storage_path }, error: null });

    await uploadMediaFile(row.storage_path, 'file:///tmp/a.jpg', 'image/jpeg');

    expect(mockUpload).toHaveBeenCalledWith(row.storage_path, expect.any(ArrayBuffer), {
      contentType: 'image/jpeg',
      upsert: false,
    });
  });

  test('reads a duplicate as already uploaded', async () => {
    // A replayed chain finds its file from the earlier attempt: not a failure.
    mockUpload.mockResolvedValue({
      data: null,
      error: { message: 'The resource already exists', statusCode: '409' },
    });

    await expect(
      uploadMediaFile(row.storage_path, 'file:///tmp/a.jpg', 'image/jpeg'),
    ).resolves.toBeUndefined();
  });

  test('throws anything else', async () => {
    mockUpload.mockResolvedValue({
      data: null,
      error: { message: 'new row violates row-level security policy', statusCode: '403' },
    });

    await expect(
      uploadMediaFile(row.storage_path, 'file:///tmp/a.jpg', 'image/jpeg'),
    ).rejects.toMatchObject({ statusCode: '403' });
  });
});

describe('fetchTaskMedia', () => {
  test('parses the rows of a task', async () => {
    listResponse.data = [row];

    const media = await fetchTaskMedia(row.task_id);

    expect(media).toHaveLength(1);
    expect(media[0].kind).toBe('photo');
  });
});

describe('signedMediaUrls', () => {
  test('maps each path to its link and drops the ones the server would not sign', async () => {
    mockCreateSignedUrls.mockResolvedValue({
      data: [
        { path: 'a.jpg', signedUrl: 'https://x/a', error: null },
        { path: 'b.jpg', signedUrl: null, error: 'Object not found' },
      ],
      error: null,
    });

    await expect(signedMediaUrls(['a.jpg', 'b.jpg'])).resolves.toEqual({ 'a.jpg': 'https://x/a' });
  });

  test('asks for nothing when there is nothing to show', async () => {
    await expect(signedMediaUrls([])).resolves.toEqual({});
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
  });
});
