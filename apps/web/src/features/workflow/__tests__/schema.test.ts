import { describe, expect, test } from 'vitest';

import {
  STEP_CATALOGUE,
  WORKFLOW_SCOPES,
  emptyStep,
  isLiveStep,
  processDraftFrom,
  processPayload,
  processProblem,
  type ProcessDraft,
  type StepDraft,
  type WorkflowStep,
  type WorkflowTemplate,
} from '../schema';

const template = (overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate => ({
  id: 't1',
  scope: 'cleaning',
  property_id: null,
  name: 'Стандартная уборка',
  is_active: true,
  version: 3,
  ...overrides,
});

const step = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: 's1',
  type: 'confirmation',
  required: false,
  title: null,
  instructions: null,
  min_photos: null,
  max_photos: null,
  max_video_sec: null,
  ...overrides,
});

const draft = (overrides: Partial<ProcessDraft> = {}): ProcessDraft => ({
  scope: 'cleaning',
  propertyId: null,
  name: 'Уборка',
  isActive: true,
  steps: [],
  ...overrides,
});

const photoStep = (overrides: Partial<StepDraft> = {}): StepDraft => ({
  ...emptyStep('photos_after'),
  ...overrides,
});

// Every task type the panel can create must have a process to build, or the
// task reaches the cleaner with no steps and nothing says why. The four here
// are the whole `workflow_scope` column (20260905110000).
describe('the scopes offered', () => {
  test('covers every value of the workflow_scope column', () => {
    expect([...WORKFLOW_SCOPES]).toEqual(['cleaning', 'midstay', 'problem', 'inspection']);
  });

  test('leaves cleanings first, so the screen opens where the work is', () => {
    expect(WORKFLOW_SCOPES[0]).toBe('cleaning');
  });

  test('includes the two a task can be created with but had no process', () => {
    expect(WORKFLOW_SCOPES).toContain('midstay');
    expect(WORKFLOW_SCOPES).toContain('inspection');
  });

  test('a mid-stay process keeps its scope through the payload', () => {
    const payload = processPayload(draft({ scope: 'midstay', name: 'Уборка в проживание' }));

    expect((payload as { scope: string }).scope).toBe('midstay');
  });

  test('an inspection process keeps its scope through the payload', () => {
    const payload = processPayload(draft({ scope: 'inspection', name: 'Осмотр' }));

    expect((payload as { scope: string }).scope).toBe('inspection');
  });
});

describe('the step catalogue', () => {
  test('offers only steps the app can run', () => {
    for (const type of STEP_CATALOGUE) {
      expect(isLiveStep(type)).toBe(true);
    }
  });

  test('leaves out the types reserved for later phases', () => {
    expect(STEP_CATALOGUE).not.toContain('inventory');
    expect(STEP_CATALOGUE).not.toContain('special_requests');
    expect(isLiveStep('inventory')).toBe(false);
  });
});

describe('reading a process into the editor', () => {
  test('the company default is the editor own template', () => {
    const result = processDraftFrom({ template: template(), steps: [step()] }, 'cleaning', null);

    expect(result.id).toBe('t1');
    expect(result.name).toBe('Стандартная уборка');
    expect(result.steps[0].id).toBe('s1');
  });

  test('a listing with its own process edits that one', () => {
    const own = template({ id: 't2', property_id: 42, name: 'Свой процесс' });

    const result = processDraftFrom({ template: own, steps: [step({ id: 's9' })] }, 'cleaning', 42);

    expect(result.id).toBe('t2');
    expect(result.propertyId).toBe(42);
    expect(result.steps[0].id).toBe('s9');
  });

  // A listing that inherits shows the inherited steps, but they are somebody
  // else's rows: saving them must create this listing's own template rather
  // than edit the one it was borrowing from.
  test('an inherited process is borrowed without its ids', () => {
    const result = processDraftFrom({ template: template(), steps: [step()] }, 'cleaning', 42);

    expect(result.id).toBeUndefined();
    expect(result.propertyId).toBe(42);
    expect(result.steps[0].id).toBeUndefined();
    expect(result.steps).toHaveLength(1);
  });

  test('a scope with no process at all opens empty', () => {
    const result = processDraftFrom({ template: null, steps: [] }, 'problem', null);

    expect(result.id).toBeUndefined();
    expect(result.steps).toEqual([]);
    expect(result.scope).toBe('problem');
  });

  test('text the server left null reads as an empty field', () => {
    const result = processDraftFrom(
      { template: template(), steps: [step({ title: null, instructions: null })] },
      'cleaning',
      null,
    );

    expect(result.steps[0].title).toBe('');
    expect(result.steps[0].instructions).toBe('');
  });
});

describe('a step just added', () => {
  test('is optional and carries no limits of its own', () => {
    const fresh = emptyStep('photos_before');

    expect(fresh.id).toBeUndefined();
    expect(fresh.required).toBe(false);
    expect(fresh.minPhotos).toBeNull();
    expect(fresh.maxPhotos).toBeNull();
  });
});

describe('what may be saved', () => {
  test('a process without a name cannot be', () => {
    expect(processProblem(draft({ name: '   ' }))).toBe('blankName');
  });

  test('a photo range that reads backwards cannot be', () => {
    const steps = [photoStep({ minPhotos: 4, maxPhotos: 2 })];

    expect(processProblem(draft({ steps }))).toBe('photoRangeInvalid');
  });

  test('nor a maximum of no photos at all', () => {
    const steps = [photoStep({ maxPhotos: 0 })];

    expect(processProblem(draft({ steps }))).toBe('photoMaxInvalid');
  });

  test('a video longer than the server allows cannot be', () => {
    const steps = [{ ...emptyStep('video'), maxVideoSec: 601 }];

    expect(processProblem(draft({ steps }))).toBe('videoLengthInvalid');
  });

  test('nor one of no seconds', () => {
    const steps = [{ ...emptyStep('video'), maxVideoSec: 0 }];

    expect(processProblem(draft({ steps }))).toBe('videoLengthInvalid');
  });

  // The table refuses it too (`not required or type = any (supported)`), but a
  // CHECK violation reaches the manager as a wall of Postgres.
  test('a step the app cannot run cannot be made required', () => {
    const steps = [{ ...emptyStep('photos_after'), type: 'inventory' as const, required: true }];

    expect(processProblem(draft({ steps }))).toBe('requiredNotSupported');
  });

  test('an ordinary process has nothing wrong with it', () => {
    const steps = [photoStep({ minPhotos: 1, maxPhotos: 4 }), emptyStep('cleaner_comment')];

    expect(processProblem(draft({ steps }))).toBeNull();
  });

  test('and so does one whose limits are left to the server', () => {
    expect(processProblem(draft({ steps: [photoStep()] }))).toBeNull();
  });
});

describe('the payload', () => {
  test('names the company default with a null listing', () => {
    const payload = processPayload(draft()) as Record<string, unknown>;

    expect(payload.property_id).toBeNull();
    expect(payload.scope).toBe('cleaning');
    expect(payload.is_active).toBe(true);
  });

  test('trims the name and drops an id the draft never had', () => {
    const payload = processPayload(draft({ name: '  Уборка  ' })) as Record<string, unknown>;

    expect(payload.name).toBe('Уборка');
    expect('id' in payload).toBe(false);
  });

  test('an existing step keeps its id, a new one goes without', () => {
    const steps = [{ ...emptyStep('confirmation'), id: 's1' }, emptyStep('cleaner_comment')];

    const payload = processPayload(draft({ steps })) as { steps: Record<string, unknown>[] };

    expect(payload.steps[0].id).toBe('s1');
    expect('id' in payload.steps[1]).toBe(false);
  });

  test('blank wording is sent as nothing, so the app names the step itself', () => {
    const steps = [{ ...emptyStep('confirmation'), title: '  ', instructions: '' }];

    const payload = processPayload(draft({ steps })) as { steps: Record<string, unknown>[] };

    expect(payload.steps[0].title).toBeNull();
    expect(payload.steps[0].instructions).toBeNull();
  });

  // The table refuses limits on a step that does not collect media. A number
  // left behind by an earlier edit must not travel with the payload.
  test('photo limits are dropped from a step that takes no photos', () => {
    const steps = [{ ...emptyStep('confirmation'), minPhotos: 1, maxPhotos: 4 }];

    const payload = processPayload(draft({ steps })) as { steps: Record<string, unknown>[] };

    expect(payload.steps[0].min_photos).toBeNull();
    expect(payload.steps[0].max_photos).toBeNull();
  });

  test('and the length of a video from a step that takes none', () => {
    const steps = [{ ...emptyStep('photos_after'), maxVideoSec: 30 }];

    const payload = processPayload(draft({ steps })) as { steps: Record<string, unknown>[] };

    expect(payload.steps[0].max_video_sec).toBeNull();
  });

  test('translations are not part of it, so the ones on the row survive', () => {
    const steps = [{ ...emptyStep('confirmation'), title: 'Финальная проверка' }];

    const payload = processPayload(draft({ steps })) as { steps: Record<string, unknown>[] };

    expect('title_i18n' in payload.steps[0]).toBe(false);
    expect('instructions_i18n' in payload.steps[0]).toBe(false);
  });
});
