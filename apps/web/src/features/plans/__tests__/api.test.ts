import { describe, expect, test, vi } from 'vitest';

import { problemSchema } from '@/features/problems/schema';

import { fetchPlan, launchPlan, savePlan, type Client } from '../api';
import { draftFromStep, wireStep, type DraftStep } from '../draft-model';
import { PLAN_PRIORITIES, planSchema } from '../schema';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';

const plan = {
  id: PLAN_ID,
  property_id: 7,
  property_name: 'Flat',
  title: 'Plan',
  status: 'draft',
  rev: 2,
  created_at: '2026-11-06T10:00:00.000000+00:00',
  launched_at: null,
  cancelled_at: null,
  closed_at: null,
  steps: [],
};

function clientAnswering(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc } as unknown as Client, rpc };
}

const step: DraftStep = {
  id: '22222222-2222-4222-8222-222222222222',
  theme: 'wifi',
  kind: 'repair',
  title: 'Fix',
  title_i18n: {},
  description: '',
  assignee_id: null,
  due_on: null,
  priority: 'normal',
  linked_problem_id: null,
};

describe('the plans API', () => {
  test('a plan that is not the company’s reads as nothing', async () => {
    const { client } = clientAnswering(null);

    expect(await fetchPlan(client, PLAN_ID)).toBeNull();
  });

  test('a new plan sends no revision: null there would read as a stale one', async () => {
    const { client, rpc } = clientAnswering(plan);

    await savePlan(client, { planId: PLAN_ID, placeId: 7, title: 'Plan', steps: [step], rev: null });

    const sent = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(rpc.mock.calls[0][0]).toBe('save_resolution_plan');
    expect(sent).not.toHaveProperty('p_rev');
    expect(sent.p_steps).toEqual([expect.objectContaining({ id: step.id, theme: 'wifi' })]);
  });

  test('an open plan sends the revision it read', async () => {
    const { client, rpc } = clientAnswering(plan);

    await savePlan(client, { planId: PLAN_ID, placeId: 7, title: 'Plan', steps: [], rev: 2 });

    expect(rpc.mock.calls[0][1]).toMatchObject({ p_rev: 2 });
  });

  test('a refusal comes through for the screen to translate', async () => {
    const refusal = { message: 'x', hint: 'serverErrors.planChanged' };
    const { client } = clientAnswering(null, refusal);

    await expect(launchPlan(client, PLAN_ID, 2)).rejects.toBe(refusal);
  });
});

describe('the level above high on a step (20261115140000)', () => {
  test('a step that reads high with the flag is «Критическая»; without it, high', () => {
    const answered = {
      id: '33333333-3333-4333-8333-333333333333',
      theme: 'plumbing',
      kind: 'repair',
      title: 'Fix the pipe',
      title_i18n: {},
      description: null,
      assignee_id: null,
      assignee_name: null,
      due_on: null,
      priority: 'high',
      linked_problem_id: null,
      launched_at: null,
      state: 'draft',
      work_status: null,
      closed_at: null,
    };
    const read = planSchema.parse({
      ...plan,
      steps: [
        { ...answered, critical: true },
        { ...answered, id: '22222222-2222-4222-8222-222222222222' },
      ],
    });
    expect(read.steps.map((item) => item.priority)).toEqual(['critical', 'high']);
    // Read, edited as a draft, saved: the level goes back as it came, never lost or made up.
    expect(read.steps.map((item) => wireStep(draftFromStep(item)).priority)).toEqual(['critical', 'high']);
    // A flag the panel cannot read is no flag.
    const odd = planSchema.parse({ ...plan, steps: [{ ...answered, critical: 'yes' }] });
    expect(odd.steps[0].priority).toBe('high');
  });

  test('the step goes out as the level: the server reads «critical» as high with the flag', () => {
    expect(wireStep({ ...step, priority: 'critical' }).priority).toBe('critical');
    expect(PLAN_PRIORITIES).toEqual(['low', 'normal', 'high', 'critical']);
  });
});

describe('a task a plan made', () => {
  test('reads as the staff’s on a build that does not know the source', () => {
    const parsed = problemSchema.parse({
      id: PLAN_ID,
      property_id: 1,
      task_id: null,
      reported_by: '33333333-3333-4333-8333-333333333333',
      title: 'Fix',
      description: null,
      priority: 'normal',
      status: 'open',
      resolved_at: null,
      cancelled_at: null,
      cancel_reason: null,
      created_at: '2026-11-06T10:00:00+00:00',
      property: { name: 'Flat' },
      reporter: { full_name: 'Boss' },
      fix_tasks: [],
      source: 'plan',
      source_facts: { kind: 'plan', subject: 'heating', plan_id: PLAN_ID },
    });

    expect(parsed.source).toBe('staff');
  });
});
