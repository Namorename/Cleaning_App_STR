import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Addition } from '../additions-api';

/**
 * The office adds photos, videos and a comment to a task (owner, 2026-11-26): the closing's
 * dialog with nothing, a comment, files, both, and a file that fails; the task page's
 * «Добавлено менеджером» and the closing block; the dialog that adds files to an open task.
 */

const attach = vi.fn();
vi.mock('../additions-api', () => ({
  attachOfficeFile: (...args: unknown[]) => attach(...args),
}));

vi.mock('../office-files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../office-files')>()),
  // The browser's drawing and video reading are not jsdom's: a photo goes as picked, a video is 30 s.
  preparePhoto: (file: File) => Promise.resolve(file),
  readVideoDuration: () => Promise.resolve(30),
}));

const publish = vi.fn();
const additionsState: { data: Addition[] } = { data: [] };
vi.mock('../use-problems', () => ({
  useWorkers: () => ({
    data: [{ id: 'tech-1', full_name: 'Иван Техник', is_active: true }],
    isPending: false,
    isError: false,
  }),
  useAdditions: () => ({ data: additionsState.data, isPending: false, isError: false, error: null }),
  usePublishOfficeFiles: () => ({ mutate: publish, isPending: false, isError: false, error: null }),
}));

vi.mock('@/features/settings/use-settings', () => ({
  useHostSettings: () => ({ data: { video_max_sec: 120, video_max_mb: 100 } }),
}));
vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

import { ClosingAddition, OfficeAdditionsSection } from '../problem-additions';
import { ResolveDialog, type ResolveChoice } from '../resolve-dialog';
import type { Problem } from '../schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROBLEM_ID = '11111111-1111-4111-8111-111111111111';

const problem = {
  id: PROBLEM_ID,
  title: 'Течёт кран',
  status: 'assigned',
  fix_tasks: [],
} as unknown as Problem;

const photo = (name = 'kitchen.jpg') =>
  new File(['photo'], name, { type: 'image/jpeg', lastModified: 0 });

beforeEach(() => {
  attach.mockReset();
  attach.mockResolvedValue(undefined);
  publish.mockReset();
  additionsState.data = [];
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

function openResolve() {
  const onConfirm = vi.fn<(choice: ResolveChoice) => void>();
  render(
    <ResolveDialog open problem={problem} isBusy={false} onConfirm={onConfirm} onClose={vi.fn()} />,
  );
  const dialog = screen.getByRole('dialog');
  return { dialog, onConfirm };
}

/**
 * Files as the file dialog hands them over. Not userEvent.upload: in jsdom it walks the focus
 * through the hidden input, which the dialog's focus trap (Base UI) cannot read; a browser's file
 * dialog never moves the focus that way.
 */
const drop = (dialog: HTMLElement, files: File[]) =>
  fireEvent.change(within(dialog).getByTestId('office-files-input'), { target: { files } });

const pick = async (dialog: HTMLElement, files: File[]) => {
  drop(dialog, files);
  await waitFor(() => expect(within(dialog).getAllByRole('listitem')).toHaveLength(files.length));
};

describe('«Отметить выполненным» with what the manager adds', () => {
  test('nothing added: one press closes, exactly as before, and nothing is sent', async () => {
    const { dialog, onConfirm } = openResolve();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Да, выполнено' }));
    expect(onConfirm).toHaveBeenCalledWith({ completedBy: null, closing: null });
    expect(attach).not.toHaveBeenCalled();
  });

  test('with a comment: the words, trimmed, with the batch’s and the message’s ids', async () => {
    const { dialog, onConfirm } = openResolve();
    await userEvent.type(
      within(dialog).getByLabelText('Комментарий (необязательно)'),
      '  Кран заменён  ',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Да, выполнено' }));
    expect(onConfirm).toHaveBeenCalledWith({
      completedBy: null,
      closing: {
        additionId: expect.stringMatching(UUID),
        comment: 'Кран заменён',
        commentId: expect.stringMatching(UUID),
      },
    });
  });

  test('with files: they go first, into the closing’s batch, then the closing', async () => {
    const { dialog, onConfirm } = openResolve();
    await userEvent.selectOptions(within(dialog).getByLabelText('Кто выполнил'), 'tech-1');
    await pick(dialog, [photo(), new File(['v'], 'tap.mp4', { type: 'video/mp4' })]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Да, выполнено' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    const choice = onConfirm.mock.calls[0][0];
    expect(choice.completedBy).toBe('tech-1');
    expect(choice.closing).toMatchObject({ comment: null });
    expect(attach.mock.calls.map(([, variables]) => [variables.kind, variables.additionId])).toEqual([
      ['photo', choice.closing?.additionId],
      ['video', choice.closing?.additionId],
    ]);
    expect(attach.mock.calls[1][1]).toMatchObject({ durationSec: 30, problemId: PROBLEM_ID });
  });

  test('with both: the files and the words in one closing', async () => {
    const { dialog, onConfirm } = openResolve();
    await userEvent.type(within(dialog).getByLabelText('Комментарий (необязательно)'), 'Готово');
    await pick(dialog, [photo()]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Да, выполнено' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm.mock.calls[0][0].closing).toMatchObject({ comment: 'Готово' });
    expect(attach).toHaveBeenCalledTimes(1);
  });

  test('a file that fails: the dialog stays with the reason; nothing closes on its own', async () => {
    attach.mockRejectedValueOnce({
      message: 'too large',
      hint: 'serverErrors.mediaTooLarge',
      details: '{"limit_mb":20}',
    });
    const { dialog, onConfirm } = openResolve();
    await userEvent.type(within(dialog).getByLabelText('Комментарий (необязательно)'), 'Готово');
    await pick(dialog, [photo('broken.jpg')]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Да, выполнено' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Не загрузилось: broken.jpg');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('Комментарий (необязательно)')).toHaveValue('Готово');
    expect(within(dialog).getByRole('button', { name: 'Повторить' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Закрыть без них' })).toBeEnabled();
  });

  test('tried again, the same file is sent under the same id, and then it closes', async () => {
    attach.mockRejectedValueOnce(new Error('network'));
    const { dialog, onConfirm } = openResolve();
    await pick(dialog, [photo()]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Да, выполнено' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Повторить' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(attach).toHaveBeenCalledTimes(2);
    expect(attach.mock.calls[1][1].mediaId).toBe(attach.mock.calls[0][1].mediaId);
    expect(onConfirm.mock.calls[0][0].closing).not.toBeNull();
  });

  test('«Закрыть без них»: the manager’s choice closes with the words and without the file', async () => {
    attach.mockRejectedValueOnce(new Error('network'));
    const { dialog, onConfirm } = openResolve();
    await userEvent.type(within(dialog).getByLabelText('Комментарий (необязательно)'), 'Готово');
    await pick(dialog, [photo()]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Да, выполнено' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Закрыть без них' }));

    expect(onConfirm).toHaveBeenCalledWith({
      completedBy: null,
      closing: expect.objectContaining({ comment: 'Готово' }),
    });
    expect(attach).toHaveBeenCalledTimes(1);
  });

  test('«Закрыть без них» with no words and nothing arrived is the closing of before', async () => {
    attach.mockRejectedValueOnce(new Error('network'));
    const { dialog, onConfirm } = openResolve();
    await pick(dialog, [photo()]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Да, выполнено' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Закрыть без них' }));
    expect(onConfirm).toHaveBeenCalledWith({ completedBy: null, closing: null });
  });

  test('a file that is not a photo or a video is not taken, and says so', async () => {
    const { dialog } = openResolve();
    drop(dialog, [new File(['%PDF'], 'act.pdf', { type: 'application/pdf' })]);
    expect(await within(dialog).findByText('act.pdf: это не фото и не видео')).toBeInTheDocument();
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0);
  });
});

const BATCH: Addition = {
  id: '22222222-2222-4222-8222-222222222222',
  stage: 'open',
  authorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  authorName: 'Пётр Менеджер',
  publishedAt: '2026-11-26T10:00:00Z',
  comment: null,
  files: [
    {
      id: 'f1',
      kind: 'photo',
      storage_path: 'p.jpg',
      mime_type: 'image/jpeg',
      duration_sec: null,
      created_at: '2026-11-26T09:59:00Z',
      uploaded_at: '2026-11-26T09:59:10Z',
      deleted_at: null,
      purged_at: null,
      url: 'https://signed/p.jpg',
    },
    {
      id: 'f2',
      kind: 'video',
      storage_path: 'v.mp4',
      mime_type: 'video/mp4',
      duration_sec: 12,
      created_at: '2026-11-26T09:59:20Z',
      uploaded_at: '2026-11-26T09:59:30Z',
      deleted_at: null,
      purged_at: null,
      url: null,
    },
  ],
};

describe('the task page', () => {
  test('«Добавлено менеджером»: who and when over each batch, its photos and videos to open', () => {
    additionsState.data = [BATCH];
    render(<OfficeAdditionsSection problemId={PROBLEM_ID} canAdd isClosed={false} />);
    expect(screen.getByText('Добавлено менеджером')).toBeInTheDocument();
    expect(screen.getByText(/^Пётр Менеджер, /)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Открыть/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Добавить фото или видео' })).toBeInTheDocument();
  });

  test('a closed task the office added nothing to shows no section at all', () => {
    const { container } = render(
      <OfficeAdditionsSection problemId={PROBLEM_ID} canAdd={false} isClosed />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('the closing’s batch stands in the closing block with its words, not in the list', () => {
    const closing: Addition = {
      ...BATCH,
      id: '33333333-3333-4333-8333-333333333333',
      stage: 'closing',
      comment: 'Кран заменён, старый в кладовке',
    };
    additionsState.data = [BATCH, closing];
    render(
      <>
        <OfficeAdditionsSection problemId={PROBLEM_ID} canAdd={false} isClosed />
        <ClosingAddition problemId={PROBLEM_ID} />
      </>,
    );
    const block = screen.getByTestId('closing-addition');
    expect(within(block).getByText('При закрытии')).toBeInTheDocument();
    expect(within(block).getByText('Комментарий при закрытии')).toBeInTheDocument();
    expect(within(block).getByText('Кран заменён, старый в кладовке')).toBeInTheDocument();
    // One batch in the list, the other in the block: two tiles each.
    expect(screen.getAllByRole('button', { name: /Открыть/ })).toHaveLength(4);
  });

  test('a closing that brought nothing draws nothing in the closing block', () => {
    additionsState.data = [BATCH];
    const { container } = render(<ClosingAddition problemId={PROBLEM_ID} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('adding files to an open task', () => {
  async function openAdd() {
    render(<OfficeAdditionsSection problemId={PROBLEM_ID} canAdd isClosed={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Добавить фото или видео' }));
    return screen.getByRole('dialog', { name: 'Фото и видео к заданию' });
  }

  test('picked, sent, and the batch published under the files’ batch id', async () => {
    const dialog = await openAdd();
    await pick(dialog, [photo('a.jpg'), photo('b.jpg')]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(publish).toHaveBeenCalled());
    const additionId = publish.mock.calls[0][0];
    expect(additionId).toMatch(UUID);
    expect(attach.mock.calls.map(([, variables]) => variables.additionId)).toEqual([
      additionId,
      additionId,
    ]);
  });

  test('one fails: it is said, and the rest go only by the manager’s «Добавить без них»', async () => {
    attach.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('network'));
    const dialog = await openAdd();
    await pick(dialog, [photo('a.jpg'), photo('b.jpg')]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Не загрузилось: b.jpg');
    expect(publish).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Добавить без них' }));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  test('a picked file is taken out before sending', async () => {
    const dialog = await openAdd();
    await pick(dialog, [photo('a.jpg')]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Убрать: a.jpg' }));
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(dialog).getByRole('button', { name: 'Добавить' })).toBeDisabled();
  });
});
