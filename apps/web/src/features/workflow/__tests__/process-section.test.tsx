import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ProcessDraft, ProcessSource, WorkflowStep, WorkflowTemplate } from '../schema';

const template = (overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate => ({
  id: 't-default',
  scope: 'cleaning',
  property_id: null,
  name: 'Стандартная уборка',
  is_active: true,
  version: 1,
  ...overrides,
});

const step = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: 's1',
  type: 'confirmation',
  required: false,
  title: 'Финальная проверка',
  instructions: null,
  min_photos: null,
  max_photos: null,
  max_video_sec: null,
  ...overrides,
});

const DEFAULT_SOURCE: ProcessSource = {
  template: template(),
  steps: [step({ id: 's1', type: 'photos_before', title: 'Фото до' }), step({ id: 's2' })],
};

const processState = {
  data: DEFAULT_SOURCE as ProcessSource | undefined,
  isPending: false,
  isError: false,
};
const saveState = { isPending: false, isError: false, isSuccess: false, error: null as unknown };
const save = vi.fn();

vi.mock('../use-workflow', () => ({
  useProcess: () => processState,
  useSaveProcess: () => ({ ...saveState, mutate: save }),
}));

vi.mock('@/features/team/use-team', () => ({
  useProperties: () => ({
    data: [
      { id: 101, name: 'Vinohrady 12' },
      { id: 102, name: 'Anděl 4' },
    ],
    isPending: false,
    isError: false,
  }),
}));

import { ProcessSection } from '../process-section';

/** Switch the target to one listing and choose it. */
async function chooseListing(name: string) {
  await userEvent.selectOptions(screen.getByLabelText('Где применяется'), 'property');
  await userEvent.selectOptions(screen.getByLabelText('Объект'), name);
}

const savedDraft = (): ProcessDraft => save.mock.calls[0][0] as ProcessDraft;

const stepCard = (title: string): HTMLElement =>
  screen.getAllByRole('listitem').find((item) => item.textContent?.includes(title)) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  processState.data = DEFAULT_SOURCE;
  processState.isPending = false;
  processState.isError = false;
  saveState.isPending = false;
  saveState.isError = false;
  saveState.isSuccess = false;
  saveState.error = null;
});

describe('the company process', () => {
  test('opens on cleanings, with the steps it has', () => {
    render(<ProcessSection />);

    expect(screen.getByLabelText('Процесс для')).toHaveValue('cleaning');
    expect(screen.getByText(/Шаг 1 · Фото до/)).toBeInTheDocument();
    expect(screen.getByText(/Шаг 2 · Подтверждение/)).toBeInTheDocument();
  });

  // The task form can already create all four kinds. A kind missing from here
  // is a task that reaches the cleaner with no steps at all.
  test('offers a process for every kind of task the panel can create', () => {
    render(<ProcessSection />);

    const options = within(screen.getByLabelText('Процесс для')).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual([
      'Уборки',
      'Уборки в проживание',
      'Устранения проблем',
      'Осмотры',
    ]);
  });

  test('switching to inspections asks the server for that process', async () => {
    render(<ProcessSection />);

    await userEvent.selectOptions(screen.getByLabelText('Процесс для'), 'inspection');

    expect(screen.getByLabelText('Процесс для')).toHaveValue('inspection');
  });

  // Switching off the company default would leave every cleaning with no
  // steps at all. It is legal and almost certainly a mistake, so the screen
  // does not offer it.
  test('has no switch for turning itself off', () => {
    render(<ProcessSection />);

    expect(screen.queryByLabelText('Применять этот процесс к объекту')).toBeNull();
  });

  test('saves under the company, not under a listing', async () => {
    render(<ProcessSection />);

    await userEvent.click(screen.getByRole('button', { name: 'Сохранить процесс' }));

    expect(savedDraft().propertyId).toBeNull();
    expect(savedDraft().id).toBe('t-default');
  });

  test('a process nobody has built yet says so', () => {
    processState.data = { template: null, steps: [] };

    render(<ProcessSection />);

    expect(screen.getByRole('status')).toHaveTextContent('Процесса для этого вида задач ещё нет.');
  });

  // A blank name is a complaint about an empty form nobody has filled in yet.
  test('and does not scold anyone for not having filled it in', () => {
    processState.data = { template: null, steps: [] };

    render(<ProcessSection />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Сохранить процесс' })).toBeDisabled();
  });
});

describe('a listing that follows the shared process', () => {
  test('is told whose process it is running', async () => {
    render(<ProcessSection />);

    await chooseListing('Vinohrady 12');

    expect(screen.getByRole('status')).toHaveTextContent('У объекта нет своего процесса');
    expect(screen.getByRole('status')).toHaveTextContent('Стандартная уборка');
  });

  // The steps on screen belong to the company default. Saving them has to
  // write a template for this listing, not rewrite the one it was borrowing.
  test('and saving writes the listing its own, borrowing the steps', async () => {
    render(<ProcessSection />);
    await chooseListing('Vinohrady 12');

    await userEvent.click(screen.getByRole('button', { name: 'Сохранить процесс' }));

    const draft = savedDraft();
    expect(draft.propertyId).toBe(101);
    expect(draft.id).toBeUndefined();
    expect(draft.steps).toHaveLength(2);
    expect(draft.steps.every((one) => one.id === undefined)).toBe(true);
  });
});

describe('a listing with a process of its own', () => {
  beforeEach(() => {
    processState.data = {
      template: template({ id: 't-own', property_id: 101, name: 'Люкс' }),
      steps: [step({ id: 's9', type: 'checklist', title: 'Чек-лист' })],
    };
  });

  test('edits that one, ids and all', async () => {
    render(<ProcessSection />);
    await chooseListing('Vinohrady 12');

    await userEvent.click(screen.getByRole('button', { name: 'Сохранить процесс' }));

    expect(savedDraft().id).toBe('t-own');
    expect(savedDraft().steps[0].id).toBe('s9');
  });

  test('and can be sent back to the shared one without losing its steps', async () => {
    render(<ProcessSection />);
    await chooseListing('Vinohrady 12');

    await userEvent.click(screen.getByLabelText('Применять этот процесс к объекту'));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить процесс' }));

    expect(savedDraft().isActive).toBe(false);
    expect(savedDraft().steps).toHaveLength(1);
  });

  test('a paused one says the shared process is what runs', async () => {
    processState.data = {
      template: template({ id: 't-own', property_id: 101, is_active: false }),
      steps: [],
    };

    render(<ProcessSection />);
    await chooseListing('Vinohrady 12');

    expect(screen.getByRole('status')).toHaveTextContent('выключен');
  });
});

describe('editing the steps', () => {
  test('a step is added from the catalogue', async () => {
    render(<ProcessSection />);

    await userEvent.selectOptions(screen.getByLabelText('Добавить шаг'), 'cleaner_comment');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить шаг' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить процесс' }));

    expect(savedDraft().steps).toHaveLength(3);
    expect(savedDraft().steps[2].type).toBe('cleaner_comment');
  });

  test('the catalogue leaves out what the app cannot run', () => {
    render(<ProcessSection />);

    const options = within(screen.getByLabelText('Добавить шаг')).getAllByRole('option');
    const names = options.map((option) => option.textContent);

    expect(names).not.toContain('Инвентарь');
    expect(names).not.toContain('Особые пожелания');
  });

  test('the arrows are the order, and the order is what is saved', async () => {
    render(<ProcessSection />);

    await userEvent.click(screen.getByRole('button', { name: 'Шаг 2 — выше' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить процесс' }));

    expect(savedDraft().steps[0].type).toBe('confirmation');
    expect(savedDraft().steps[1].type).toBe('photos_before');
  });

  test('a removed step is saved by being absent', async () => {
    render(<ProcessSection />);

    await userEvent.click(screen.getByRole('button', { name: 'Удалить шаг 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить процесс' }));

    expect(savedDraft().steps).toHaveLength(1);
    expect(savedDraft().steps[0].type).toBe('confirmation');
  });

  test('limits are offered only where the step can carry them', () => {
    render(<ProcessSection />);

    expect(within(stepCard('Фото до')).getByLabelText(/Мин\. фото/)).toBeInTheDocument();
    expect(within(stepCard('Подтверждение')).queryByLabelText(/Мин\. фото/)).toBeNull();
  });

  test('a step the app cannot run yet cannot be made required', () => {
    processState.data = {
      template: template(),
      steps: [step({ id: 's1', type: 'inventory', title: 'Инвентарь' })],
    };

    render(<ProcessSection />);

    expect(screen.getByLabelText('Обязательный')).toBeDisabled();
    expect(screen.getByText(/приложение пока не умеет этот шаг/i)).toBeInTheDocument();
  });
});

describe('what the editor refuses to send', () => {
  test('a maximum of no photos at all', async () => {
    render(<ProcessSection />);

    await userEvent.type(within(stepCard('Фото до')).getByLabelText(/Макс\. фото/), '0');

    expect(screen.getByRole('alert')).toHaveTextContent('Максимум фото — хотя бы одно.');
    expect(screen.getByRole('button', { name: 'Сохранить процесс' })).toBeDisabled();
  });

  test('a process left without a name', async () => {
    render(<ProcessSection />);

    await userEvent.clear(screen.getByLabelText('Название процесса'));

    expect(screen.getByRole('alert')).toHaveTextContent('У процесса должно быть название.');
    expect(save).not.toHaveBeenCalled();
  });
});
