import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  checklistPayload,
  checklistProblem,
  checklistSchema,
  moveAt,
  propertySchema,
  removeAt,
  type ChecklistModule,
  type Property,
} from '../schema';

const FLAT = 101;
const PARENT = 100;
const OTHER = 102;

const listing = (id: number, name: string, overrides: Record<string, unknown> = {}): Property =>
  propertySchema.parse({
    id,
    name,
    address: null,
    city: null,
    status: 'active',
    parent_id: null,
    bedrooms: 1,
    max_guests: 2,
    ...overrides,
  });

const all = [
  listing(PARENT, 'Whole flat'),
  listing(FLAT, 'Room A', { parent_id: PARENT }),
  listing(OTHER, 'Anděl 4'),
  listing(103, 'Karlín 7', { status: 'archived' }),
];

const stored: ChecklistModule[] = [
  {
    id: 'm1',
    title: 'Кухня',
    items: [
      { id: 'i1', title: 'Помыть плиту', is_optional: false },
      { id: 'i2', title: 'Протереть вытяжку', is_optional: true },
    ],
  },
  {
    id: 'm2',
    title: 'Ванная',
    items: [{ id: 'i3', title: 'Заменить полотенца', is_optional: false }],
  },
];

const saveChecklist = vi.fn();
const copyChecklist = vi.fn();
const state = { owner: FLAT as number, isSuccess: false };

vi.mock('../use-apartments', () => ({
  useChecklist: () => ({ data: stored, isPending: false, isError: false }),
  useChecklistOwner: () => ({ data: state.owner, isPending: false, isError: false }),
  useSaveChecklist: () => ({
    isPending: false,
    isError: false,
    isSuccess: state.isSuccess,
    error: null,
    mutate: saveChecklist,
  }),
  useCopyChecklist: () => ({ isPending: false, isError: false, error: null, mutate: copyChecklist }),
}));

import { ChecklistTab } from '../checklist-tab';

beforeEach(() => {
  vi.clearAllMocks();
  state.owner = FLAT;
  state.isSuccess = false;
});

// ---------------------------------------------------------------------------
//  The pure half
// ---------------------------------------------------------------------------

describe('the shape that may be saved', () => {
  test('a blank title is refused, wherever it is', () => {
    expect(checklistProblem([{ title: '', items: [{ title: 'x', is_optional: false }] }])).toBe(
      'blankTitle',
    );
    expect(
      checklistProblem([{ title: 'Кухня', items: [{ title: '  ', is_optional: false }] }]),
    ).toBe('blankTitle');
  });

  test('a section with no items is refused — the snapshot would drop it anyway', () => {
    expect(checklistProblem([{ title: 'Кухня', items: [] }])).toBe('emptyModule');
  });

  test('a filled list is fine', () => {
    expect(checklistProblem(stored)).toBeNull();
  });
});

describe('the payload', () => {
  test('keeps the id of what exists and omits it for what is new', () => {
    const payload = checklistPayload([
      { id: 'm1', title: ' Кухня ', items: [{ title: ' Плита ', is_optional: true }] },
    ]) as { id?: string; title: string; items: { id?: string; title: string }[] }[];

    expect(payload[0].id).toBe('m1');
    expect(payload[0].title).toBe('Кухня');
    expect('id' in payload[0].items[0]).toBe(false);
    expect(payload[0].items[0].title).toBe('Плита');
  });
});

describe('moving an entry', () => {
  test('swaps it with its neighbour', () => {
    expect(moveAt(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveAt(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });

  test('a move off either end is simply nothing', () => {
    expect(moveAt(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveAt(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });

  test('and the original list is never touched', () => {
    const list = ['a', 'b'];
    moveAt(list, 0, 1);
    removeAt(list, 0);

    expect(list).toEqual(['a', 'b']);
  });
});

describe('the snapshot parser', () => {
  test('a section the server returns without items reads as an empty one', () => {
    const parsed = checklistSchema.parse({ modules: [{ id: 'm1', title: 'Кухня', items: null }] });

    expect(parsed.modules[0].items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
//  The editor
// ---------------------------------------------------------------------------

describe('the editor', () => {
  test('shows what is stored, in order', () => {
    render(<ChecklistTab propertyId={FLAT} all={all} />);

    expect(screen.getByLabelText('Название раздела 1')).toHaveValue('Кухня');
    expect(screen.getByLabelText('Название раздела 2')).toHaveValue('Ванная');
    expect(screen.getByLabelText('Пункт 1 раздела 1')).toHaveValue('Помыть плиту');
  });

  test('an optional item is marked as one', () => {
    render(<ChecklistTab propertyId={FLAT} all={all} />);

    const boxes = within(screen.getAllByRole('listitem')[0]).getAllByRole('checkbox');
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[1]).toBeChecked();
  });

  test('order is the field: moving a section down sends it down', async () => {
    render(<ChecklistTab propertyId={FLAT} all={all} />);

    await userEvent.click(screen.getByRole('button', { name: 'Раздел 1 ниже' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить чек-лист' }));

    const sent = saveChecklist.mock.calls[0][0] as ChecklistModule[];
    expect(sent.map((one) => one.title)).toEqual(['Ванная', 'Кухня']);
  }, 20000);

  test('a removed section is saved by not being sent', async () => {
    render(<ChecklistTab propertyId={FLAT} all={all} />);

    const sections = screen.getAllByRole('listitem');
    await userEvent.click(within(sections[0]).getByRole('button', { name: 'Удалить раздел' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить чек-лист' }));

    const sent = saveChecklist.mock.calls[0][0] as ChecklistModule[];
    expect(sent.map((one) => one.title)).toEqual(['Ванная']);
  }, 20000);

  test('a section with nothing in it cannot be saved', async () => {
    render(<ChecklistTab propertyId={FLAT} all={all} />);

    await userEvent.click(screen.getByRole('button', { name: 'Добавить раздел' }));

    expect(screen.getByRole('button', { name: 'Сохранить чек-лист' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('пустое название');
    expect(saveChecklist).not.toHaveBeenCalled();
  }, 20000);
});

describe('a unit that has no checklist of its own', () => {
  test('is told whose list it is looking at', () => {
    state.owner = PARENT;
    render(<ChecklistTab propertyId={FLAT} all={all} />);

    expect(screen.getByRole('status')).toHaveTextContent('Whole flat');
    expect(screen.getByRole('status')).toHaveTextContent('связь с родительским прервётся');
  });

  test('and a flat with its own list is told nothing', () => {
    render(<ChecklistTab propertyId={FLAT} all={all} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('copying', () => {
  test('takes another listing’s checklist, and never an archived one', async () => {
    render(<ChecklistTab propertyId={FLAT} all={all} />);
    const picker = screen.getByLabelText(/Скопировать чек-лист/);

    const offered = within(picker)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(offered).toContain('Anděl 4');
    expect(offered).not.toContain('Karlín 7');
    expect(offered).not.toContain('Room A');

    await userEvent.selectOptions(picker, 'Anděl 4');
    await userEvent.click(screen.getByRole('button', { name: 'Скопировать' }));

    await waitFor(() => expect(copyChecklist).toHaveBeenCalledWith(OTHER, expect.anything()));
  }, 20000);

  test('and says that it replaces what is here', () => {
    render(<ChecklistTab propertyId={FLAT} all={all} />);

    expect(screen.getByText(/заменяет текущий чек-лист целиком/)).toBeInTheDocument();
  });
});
