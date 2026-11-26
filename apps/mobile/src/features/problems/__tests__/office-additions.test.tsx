import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import OfficeFilesRoute from '@/app/problem/[id]/add-files';
import type { CapturedMedia } from '@/features/media/capture';

import { ClosingAddition, OfficeAdditions } from '../office-additions';
import { addPick, endFlow, officeFlow, removePick, uploadPicks } from '../office-picks';

/**
 * The office adds photos and videos to a task on the phone (owner, 2026-11-26): the files picked
 * in one go and sent one by one, a file that fails kept with its reason, the screen of the files
 * at work and at the closing, and the task's «Добавлено менеджером» with the closing's block.
 */

// The ids the phone makes: real ones, so the batch and the message can be told apart.
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual<typeof import('crypto')>('crypto').randomUUID() }));

const mockAddOfficeMedia = jest.fn();
jest.mock('../additions', () => ({
  ...jest.requireActual('../additions'),
  addOfficeMedia: (...args: unknown[]) => mockAddOfficeMedia(...args),
}));

const mockUploadPhoto = jest.fn();
const mockUploadVideo = jest.fn();
const mockConfirm = jest.fn();
jest.mock('@/features/media/api', () => ({
  uploadMediaFile: (...args: unknown[]) => mockUploadPhoto(...args),
  uploadVideoFile: (...args: unknown[]) => mockUploadVideo(...args),
  confirmMedia: (...args: unknown[]) => mockConfirm(...args),
}));

const mockDiscard = jest.fn();
jest.mock('@/features/media/file', () => ({ discardFile: (uri: string) => mockDiscard(uri) }));

const mockCapture = jest.fn();
jest.mock('@/features/media/capture', () => ({
  capturePhoto: () => mockCapture(),
  pickPhotoFromGallery: () => mockCapture(),
}));

const mockPublish = jest.fn();
const mockAdditions = { data: [] as unknown[], error: null as Error | null };
jest.mock('../use-additions', () => ({
  useAdditions: () => mockAdditions,
  usePublishOfficeMedia: () => ({ mutate: mockPublish, isPending: false, error: null }),
}));

const mockResolve = jest.fn();
jest.mock('@/features/office/use-office', () => ({
  useProblemAction: () => ({ mutate: mockResolve, isPending: false, error: null }),
}));

jest.mock('@/features/board/use-board', () => ({
  useStaffDirectory: () => ({ data: [], error: null }),
}));

jest.mock('@/features/media/use-media', () => ({
  useMediaUrls: () => ({ data: { 'p.jpg': 'https://signed/p.jpg', 'v.mp4': 'https://signed/v.mp4' } }),
}));

const mockParams: { current: Record<string, string> } = { current: {} };
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: () => true, push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => mockParams.current,
}));


const PROBLEM_ID = '11111111-1111-4111-8111-111111111111';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let next = 0;
function captured(kind: 'photo' | 'video' = 'photo'): CapturedMedia {
  next += 1;
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(next).padStart(12, '0')}`,
    kind,
    uri: `task-media/${next}.${kind === 'video' ? 'mp4' : 'jpg'}`,
    mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
    byteSize: 1000,
    width: null,
    height: null,
    durationSec: kind === 'video' ? 12 : null,
    takenAt: '2026-11-26T10:00:00Z',
    source: 'camera',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  endFlow(PROBLEM_ID);
  mockAddOfficeMedia.mockImplementation((_problem: string, _addition: string, file: CapturedMedia) =>
    Promise.resolve({ storage_path: `path/${file.id}`, uploaded_at: null }),
  );
  mockUploadPhoto.mockResolvedValue(undefined);
  mockUploadVideo.mockResolvedValue(undefined);
  mockConfirm.mockResolvedValue(undefined);
  mockAdditions.data = [];
  mockAdditions.error = null;
});

describe('the files of one go', () => {
  test('each goes down the pipeline under the go’s batch: a photo whole, a video in pieces', async () => {
    const photo = captured('photo');
    const video = captured('video');
    addPick(PROBLEM_ID, photo);
    addPick(PROBLEM_ID, video);
    const { additionId } = officeFlow(PROBLEM_ID);

    await expect(uploadPicks(PROBLEM_ID)).resolves.toEqual({ done: 2, failed: 0 });

    expect(mockAddOfficeMedia.mock.calls.map(([problem, addition]) => [problem, addition])).toEqual([
      [PROBLEM_ID, additionId],
      [PROBLEM_ID, additionId],
    ]);
    expect(mockUploadPhoto).toHaveBeenCalledWith(`path/${photo.id}`, photo.uri, 'image/jpeg');
    expect(mockUploadVideo).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: video.id, storagePath: `path/${video.id}` }),
    );
    expect(mockConfirm.mock.calls).toEqual([[photo.id], [video.id]]);
  });

  test('a file that fails keeps its place and its reason; tried again, only it is sent', async () => {
    const first = captured();
    const second = captured();
    addPick(PROBLEM_ID, first);
    addPick(PROBLEM_ID, second);
    mockUploadPhoto.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('network'));

    await expect(uploadPicks(PROBLEM_ID)).resolves.toEqual({ done: 1, failed: 1 });
    expect(officeFlow(PROBLEM_ID).picks.map((pick) => pick.status)).toEqual(['done', 'failed']);

    await expect(uploadPicks(PROBLEM_ID)).resolves.toEqual({ done: 2, failed: 0 });
    expect(mockAddOfficeMedia.mock.calls.map(([, , file]) => (file as CapturedMedia).id)).toEqual([
      first.id,
      second.id,
      second.id,
    ]);
  });

  test('a file arrived before is not sent again', async () => {
    mockAddOfficeMedia.mockResolvedValue({ storage_path: 'p', uploaded_at: '2026-11-26T10:00:00Z' });
    addPick(PROBLEM_ID, captured());
    await uploadPicks(PROBLEM_ID);
    expect(mockUploadPhoto).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  test('ten files a batch; the eleventh and a taken-out one leave the phone', () => {
    for (let index = 0; index < 10; index += 1) {
      expect(addPick(PROBLEM_ID, captured())).toBe(true);
    }
    const over = captured();
    expect(addPick(PROBLEM_ID, over)).toBe(false);
    expect(mockDiscard).toHaveBeenCalledWith(over.uri);
    const out = officeFlow(PROBLEM_ID).picks[0].captured;
    removePick(PROBLEM_ID, out.id);
    expect(officeFlow(PROBLEM_ID).picks).toHaveLength(9);
    expect(mockDiscard).toHaveBeenCalledWith(out.uri);
  });
});

describe('the screen of the files', () => {
  test('at work: «Добавить» sends the files, then shows the batch', async () => {
    mockParams.current = { id: PROBLEM_ID };
    await render(<OfficeFilesRoute />);
    await act(async () => {
      addPick(PROBLEM_ID, captured());
    });
    const { additionId } = officeFlow(PROBLEM_ID);

    await fireEvent.press(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(mockPublish).toHaveBeenCalled());
    expect(mockPublish.mock.calls[0][0]).toBe(additionId);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

  test('a file that fails: said, and the others go only by «Добавить без них»', async () => {
    mockParams.current = { id: PROBLEM_ID };
    await render(<OfficeFilesRoute />);
    await act(async () => {
      addPick(PROBLEM_ID, captured());
      addPick(PROBLEM_ID, captured());
    });
    mockUploadPhoto.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('network'));

    await fireEvent.press(screen.getByRole('button', { name: 'Добавить' }));

    expect(await screen.findByText('Не загрузилось: Фото 1')).toBeOnTheScreen();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Добавить без них' }));
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  test('at the closing: the files, then the closing with the comment and who did it', async () => {
    mockParams.current = { id: PROBLEM_ID, mode: 'closing', who: 'alone', comment: 'Готово' };
    await render(<OfficeFilesRoute />);
    await act(async () => {
      addPick(PROBLEM_ID, captured());
    });
    const { additionId } = officeFlow(PROBLEM_ID);

    await fireEvent.press(screen.getByRole('button', { name: 'Да, выполнено' }));

    await waitFor(() => expect(mockResolve).toHaveBeenCalled());
    expect(mockResolve.mock.calls[0][0]).toEqual({
      kind: 'resolve',
      problemId: PROBLEM_ID,
      completedBy: null,
      closing: { additionId, comment: 'Готово', commentId: expect.stringMatching(UUID) },
    });
  });

  test('at the closing, every file failed and no words: «Закрыть без них» is the closing of before', async () => {
    mockParams.current = { id: PROBLEM_ID, mode: 'closing', who: 'alone' };
    mockUploadPhoto.mockRejectedValue(new Error('network'));
    await render(<OfficeFilesRoute />);
    await act(async () => {
      addPick(PROBLEM_ID, captured());
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Да, выполнено' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Закрыть без них' }));

    expect(mockResolve.mock.calls[0][0]).toEqual({
      kind: 'resolve',
      problemId: PROBLEM_ID,
      completedBy: null,
      closing: null,
    });
  });
});

const BATCH = {
  id: '22222222-2222-4222-8222-222222222222',
  problem_id: PROBLEM_ID,
  author_id: null,
  author_name: 'Пётр Менеджер',
  stage: 'open',
  created_at: '2026-11-26T09:59:00Z',
  published_at: '2026-11-26T10:00:00Z',
  message: null,
  files: [
    {
      id: 'f1',
      kind: 'photo',
      storage_path: 'p.jpg',
      mime_type: 'image/jpeg',
      duration_sec: null,
      created_at: '2026-11-26T09:59:10Z',
      uploaded_at: '2026-11-26T09:59:20Z',
      deleted_at: null,
      purged_at: null,
    },
    {
      id: 'f2',
      kind: 'video',
      storage_path: 'v.mp4',
      mime_type: 'video/mp4',
      duration_sec: 12,
      created_at: '2026-11-26T09:59:30Z',
      uploaded_at: '2026-11-26T09:59:40Z',
      deleted_at: null,
      purged_at: null,
    },
  ],
};

describe('the task’s screen', () => {
  test('«Добавлено менеджером»: who over the batch, its photo and its video to open', async () => {
    mockAdditions.data = [BATCH];
    await render(<OfficeAdditions problemId={PROBLEM_ID} canAdd={false} isClosed={false} />);
    const block = within(screen.getByTestId('office-additions'));
    expect(block.getByText('Добавлено менеджером')).toBeOnTheScreen();
    expect(block.getByText(/^Пётр Менеджер, /)).toBeOnTheScreen();
    expect(block.getAllByRole('button')).toHaveLength(2);
  });

  test('the office on a task at work adds from here; nobody else sees the button', async () => {
    await render(<OfficeAdditions problemId={PROBLEM_ID} canAdd isClosed={false} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Добавить фото или видео' }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/problem/[id]/add-files',
      params: { id: PROBLEM_ID },
    });
  });

  test('nothing added and nothing to add: no block at all', async () => {
    await render(<OfficeAdditions problemId={PROBLEM_ID} canAdd={false} isClosed />);
    expect(screen.queryByTestId('office-additions')).toBeNull();
  });

  test('the closing’s block: its words and files, and not in the list again', async () => {
    mockAdditions.data = [
      BATCH,
      {
        ...BATCH,
        id: '33333333-3333-4333-8333-333333333333',
        stage: 'closing',
        message: { id: 'm', body: 'Кран заменён' },
      },
    ];
    await render(
      <>
        <OfficeAdditions problemId={PROBLEM_ID} canAdd={false} isClosed />
        <ClosingAddition problemId={PROBLEM_ID} />
      </>,
    );
    const closing = within(screen.getByTestId('closing-addition'));
    expect(closing.getByText('При закрытии')).toBeOnTheScreen();
    expect(closing.getByText('Кран заменён')).toBeOnTheScreen();
    expect(within(screen.getByTestId('office-additions')).getAllByRole('button')).toHaveLength(2);
  });
});
