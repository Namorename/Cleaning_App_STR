import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { PlacePlan, Plan, PlanStep } from '../schema';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const REPAIR_ID = '22222222-2222-4222-8222-222222222222';
const CHECK_ID = '33333333-3333-4333-8333-333333333333';
const DECISION_ID = '44444444-4444-4444-8444-444444444444';
const TECH_ID = '55555555-5555-4555-8555-555555555555';
const CLEANER_ID = '66666666-6666-4666-8666-666666666666';

function mutation() {
  return { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null as unknown };
}

const state = {
  save: mutation(),
  launch: mutation(),
  remove: mutation(),
  cancel: mutation(),
  decide: mutation(),
  gather: mutation(),
  plans: { data: [] as PlacePlan[], isPending: false },
};

vi.mock('../use-plans', () => ({
  useSavePlan: () => state.save,
  useLaunchPlan: () => state.launch,
  useDeletePlan: () => state.remove,
  useCancelPlan: () => state.cancel,
  useSetStepDecided: () => state.decide,
  useGatherPlan: () => state.gather,
  usePlacePlans: () => state.plans,
}));

vi.mock('@/features/problems/use-problems', () => ({
  useStaff: () => ({
    data: [
      { id: TECH_ID, full_name: 'Tom', role: 'tech' },
      { id: CLEANER_ID, full_name: 'Anna', role: 'cleaner' },
    ],
  }),
}));

vi.mock('@/features/quality/use-quality', () => ({
  useQualityPlace: () => ({
    data: { themes: [{ theme: 'heating', reviews: 3, found: 2, reported: 0 }] },
  }),
}));

const router = { replace: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { PlacePlans, ThemePlanButton } from '../place-plans';
import { PlanDraft } from '../plan-draft';
import { PlanLaunched } from '../plan-launched';

function step(over: Partial<PlanStep>): PlanStep {
  return {
    id: REPAIR_ID,
    theme: 'heating',
    kind: 'repair',
    title: 'Починить батареи',
    title_i18n: {},
    description: null,
    assignee_id: null,
    assignee_name: null,
    due_on: null,
    priority: 'normal',
    linked_problem_id: null,
    launched_at: null,
    state: 'draft',
    work_status: null,
    closed_at: null,
    ...over,
  };
}

function plan(over: Partial<Plan> = {}): Plan {
  return {
    id: PLAN_ID,
    property_id: 7,
    property_name: 'Vinohrady 12',
    title: 'План: Vinohrady 12',
    status: 'draft',
    rev: 4,
    created_at: '2026-11-06T10:00:00+00:00',
    launched_at: null,
    cancelled_at: null,
    closed_at: null,
    steps: [
      step({}),
      step({ id: CHECK_ID, kind: 'inspection', title: 'Проверить тепло' }),
    ],
    ...over,
  };
}

function placePlan(over: Partial<PlacePlan> = {}): PlacePlan {
  return {
    id: PLAN_ID,
    title: 'План отопления',
    status: 'launched',
    rev: 2,
    created_at: '2026-11-06',
    launched_at: '2026-11-06',
    steps_total: 5,
    steps_closed: 2,
    themes: ['heating'],
    ...over,
  };
}

beforeEach(() => {
  Object.assign(state, {
    save: mutation(),
    launch: mutation(),
    remove: mutation(),
    cancel: mutation(),
    decide: mutation(),
    gather: mutation(),
    plans: { data: [], isPending: false },
  });
  router.replace.mockClear();
});

describe('PlanDraft', () => {
  test('says that nobody sees it and gathers the steps by theme with its numbers', () => {
    render(<PlanDraft plan={plan()} onReload={vi.fn()} />);

    expect(screen.getByText(/сотрудники его не видят/)).toBeInTheDocument();
    const theme = screen.getByRole('region', { name: 'Отопление' });
    expect(within(theme).getByText('3 жалобы · 2 находки')).toBeInTheDocument();
    expect(within(theme).getByDisplayValue('Починить батареи')).toBeInTheDocument();
    expect(within(theme).getByDisplayValue('Проверить тепло')).toBeInTheDocument();
  });

  test('offers a step the people of its kind alone', () => {
    render(<PlanDraft plan={plan()} onReload={vi.fn()} />);

    const [repairWho, checkWho] = screen.getAllByLabelText('Исполнитель');
    expect(within(repairWho).getByRole('option', { name: 'Tom' })).toBeInTheDocument();
    expect(within(repairWho).queryByRole('option', { name: 'Anna' })).not.toBeInTheDocument();
    expect(within(checkWho).getByRole('option', { name: 'Anna' })).toBeInTheDocument();
  });

  test('says what a launch will make before it happens', () => {
    render(<PlanDraft plan={plan()} onReload={vi.fn()} />);

    expect(screen.getByText(/заданий: 1, проверок: 1, заявок: 0, решений: 0/)).toBeInTheDocument();
  });

  test('a launch asks first, and sends nothing until the manager says yes', async () => {
    render(<PlanDraft plan={plan()} onReload={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Запустить план' }));
    expect(state.launch.mutate).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Шаги сразу появятся у сотрудников.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Запустить план' }));

    expect(state.launch.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ planId: PLAN_ID, rev: 4, save: null }),
    );
  });

  test('a change is saved by the launch itself, so what launches is what is on the screen', async () => {
    render(<PlanDraft plan={plan()} onReload={vi.fn()} />);

    await userEvent.type(screen.getByDisplayValue('Починить батареи'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Запустить план' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Запустить план' }),
    );

    const sent = state.launch.mutate.mock.calls[0][0] as { save: { steps: { title: string }[] } };
    expect(sent.save.steps[0].title).toBe('Починить батареи!');
  });

  test('a step can be removed, and the save knows it', async () => {
    render(<PlanDraft plan={plan()} onReload={vi.fn()} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Убрать шаг «Проверить тепло»' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    const [variables] = state.save.mutate.mock.calls[0] as [{ steps: { id: string }[] }];
    expect(variables.steps.map((one) => one.id)).toEqual([REPAIR_ID]);
  });

  test('nothing to save, nothing to press', () => {
    render(<PlanDraft plan={plan()} onReload={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  test('a plan of no steps cannot be launched', () => {
    render(<PlanDraft plan={plan({ steps: [] })} onReload={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Запустить план' })).toBeDisabled();
  });

  test('a refused launch says why under each step', () => {
    state.launch = {
      ...mutation(),
      isError: true,
      error: {
        hint: 'serverErrors.planNotLaunchable',
        details: JSON.stringify({ steps: [{ step: CHECK_ID, reason: 'date_missing' }] }),
      },
    };
    render(<PlanDraft plan={plan()} onReload={vi.fn()} />);

    expect(screen.getByText('Нужен срок')).toBeInTheDocument();
    expect(screen.getByText('Некоторые шаги нельзя запустить')).toBeInTheDocument();
  });

  test('a stale editor is told so and can open the plan again', async () => {
    const onReload = vi.fn();
    state.save = { ...mutation(), isError: true, error: { hint: 'serverErrors.planChanged' } };
    render(<PlanDraft plan={plan()} onReload={onReload} />);

    await userEvent.click(screen.getByRole('button', { name: 'Открыть заново' }));

    expect(onReload).toHaveBeenCalled();
  });

  test('a linked step shows its task and leaves nothing to fill in', () => {
    render(
      <PlanDraft
        plan={plan({ steps: [step({ linked_problem_id: CHECK_ID, title: 'Холодно' })] })}
        onReload={vi.fn()}
      />,
    );

    expect(screen.getByText('Уже в работе')).toBeInTheDocument();
    expect(screen.queryByLabelText('Исполнитель')).not.toBeInTheDocument();
  });

  test('a draft is deleted after a question, and the manager goes back to the card', async () => {
    state.remove.mutate = vi.fn((_: unknown, options: { onSuccess: () => void }) =>
      options.onSuccess(),
    );
    render(<PlanDraft plan={plan()} onReload={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Удалить черновик' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить черновик' }),
    );

    expect(router.replace).toHaveBeenCalledWith('/quality/7');
  });
});

describe('PlanLaunched', () => {
  const launched = (over: Partial<Plan> = {}) =>
    plan({
      status: 'launched',
      launched_at: '2026-11-06T11:00:00+00:00',
      steps: [
        step({ launched_at: '2026-11-06', state: 'open', assignee_name: 'Tom' }),
        step({ id: CHECK_ID, kind: 'inspection', launched_at: '2026-11-06', state: 'closed' }),
        step({
          id: DECISION_ID,
          kind: 'decision',
          theme: 'noise_outside',
          title: 'Шумоизоляция',
          launched_at: '2026-11-06',
          state: 'open',
        }),
      ],
      ...over,
    });

  test('shows how far it has come and each step by theme', () => {
    render(<PlanLaunched plan={launched()} />);

    expect(screen.getByText('Закрыто шагов: 1 из 3')).toBeInTheDocument();
    const heating = screen.getByRole('region', { name: 'Отопление' });
    expect(within(heating).getByText('Ремонт · Tom')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Шум с улицы' })).toBeInTheDocument();
  });

  test('a step links to where it lives', () => {
    render(<PlanLaunched plan={launched()} />);

    const links = screen.getAllByRole('link', { name: 'Открыть' }).map((a) => a.getAttribute('href'));
    expect(links).toEqual([`/problems/${REPAIR_ID}`, `/tasks/${CHECK_ID}`]);
  });

  test('a decision is closed here, the others where they live', async () => {
    render(<PlanLaunched plan={launched()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Решение принято' }));

    expect(state.decide.mutate).toHaveBeenCalledWith({ stepId: DECISION_ID, isDecided: true });
    expect(screen.getAllByRole('button', { name: 'Решение принято' })).toHaveLength(1);
  });

  test('a cancel says that what was made stays', async () => {
    render(<PlanLaunched plan={launched()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Отменить план' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Созданные задания останутся/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отменить план' }));

    expect(state.cancel.mutate).toHaveBeenCalledWith({ planId: PLAN_ID, rev: 4 });
  });

  test('a finished plan says when, and offers no cancel', () => {
    render(
      <PlanLaunched plan={launched({ status: 'done', closed_at: '2026-11-20T09:00:00+00:00' })} />,
    );

    expect(screen.getByText(/^Выполнен /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отменить план' })).not.toBeInTheDocument();
  });

  test('a cancelled plan takes no new steps', () => {
    render(<PlanLaunched plan={launched({ status: 'cancelled' })} />);

    expect(screen.queryByRole('region', { name: 'Новые шаги' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Решение принято' })).not.toBeInTheDocument();
  });

  test('a step added after the launch waits for its own', async () => {
    const pending = step({ id: DECISION_ID, title: 'Ещё шаг', state: 'draft' });
    render(<PlanLaunched plan={launched({ steps: [step({ launched_at: 'x', state: 'open' }), pending] })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Запустить новые шаги' }));

    const sent = state.launch.mutate.mock.calls[0][0] as { save: { steps: { id: string }[] } };
    expect(sent.save.steps.map((one) => one.id)).toEqual([DECISION_ID]);
  });
});

describe('the card', () => {
  test('gathers a plan from the themes that matter and no theme a plan holds', async () => {
    state.plans = { data: [placePlan()], isPending: false };
    render(<PlacePlans placeId={7} placeName="Vinohrady 12" themes={['heating', 'wifi']} />);

    await userEvent.click(screen.getByRole('button', { name: 'Собрать план' }));

    expect(state.gather.mutate).toHaveBeenCalledWith(['wifi']);
  });

  test('lists the plans with their progress', () => {
    state.plans = { data: [placePlan()], isPending: false };
    render(<PlacePlans placeId={7} placeName="Vinohrady 12" themes={[]} />);

    expect(screen.getByRole('link', { name: 'План отопления' })).toHaveAttribute(
      'href',
      `/quality/plans/${PLAN_ID}`,
    );
    expect(screen.getByText('Закрыто шагов: 2 из 5')).toBeInTheDocument();
  });

  test('says when there are none', () => {
    render(<PlacePlans placeId={7} placeName="Vinohrady 12" themes={[]} />);

    expect(screen.getByText('Планов пока нет')).toBeInTheDocument();
  });

  test('a theme goes into the plan by one press', async () => {
    render(<ThemePlanButton placeId={7} placeName="Vinohrady 12" theme="wifi" />);

    await userEvent.click(screen.getByRole('button', { name: 'В план' }));

    expect(state.gather.mutate).toHaveBeenCalledWith(['wifi']);
  });

  test('a theme already in a plan leads there', () => {
    state.plans = { data: [placePlan()], isPending: false };
    render(<ThemePlanButton placeId={7} placeName="Vinohrady 12" theme="heating" />);

    expect(screen.getByRole('link', { name: 'В плане' })).toHaveAttribute(
      'href',
      `/quality/plans/${PLAN_ID}`,
    );
  });
});
