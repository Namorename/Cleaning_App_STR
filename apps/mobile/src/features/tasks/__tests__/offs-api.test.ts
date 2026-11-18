import { serverErrorText } from '@/lib/server-error';

import { cancelCleaning, declineCleaning, interruptCleaning } from '../api';

/**
 * The three server functions of a cleaning taken off (20261118120000), called
 * by name with their arguments by name: PostgREST matches them so, and a
 * misspelt one is a call to a function that does not exist.
 */

const mockRpc = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';

/** A refusal as supabase-js hands it over: English for the logs, the key in `hint`. */
function refusal(hint: string, details = ''): object {
  return { message: 'refused', code: 'P0001', hint, details };
}

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: { id: TASK_ID }, error: null });
});

describe('declineCleaning', () => {
  test('calls decline_cleaning with the cleaning and her words', async () => {
    await declineCleaning(TASK_ID, 'Заболела');

    expect(mockRpc).toHaveBeenCalledWith('decline_cleaning', {
      p_task_id: TASK_ID,
      p_reason: 'Заболела',
    });
  });

  // No argument at all, not an empty text: the function's default says «nothing said».
  test('sends no reason when she wrote none', async () => {
    await declineCleaning(TASK_ID, null);

    // As the request's body carries it.
    expect(JSON.parse(JSON.stringify(mockRpc.mock.calls[0][1]))).toEqual({ p_task_id: TASK_ID });
  });

  test('a refusal is thrown as it came, for the screen to translate', async () => {
    mockRpc.mockResolvedValue({ data: null, error: refusal('serverErrors.taskChangedMeanwhile') });

    const failure = await declineCleaning(TASK_ID, null).catch((error: unknown) => error);

    expect(serverErrorText(failure).text).toBe('Это уже изменилось — экран обновлён');
  });
});

describe('interruptCleaning', () => {
  test('calls interrupt_cleaning with the cleaning and the reason it requires', async () => {
    await interruptCleaning(TASK_ID, 'Нет воды');

    expect(mockRpc).toHaveBeenCalledWith('interrupt_cleaning', {
      p_task_id: TASK_ID,
      p_reason: 'Нет воды',
    });
  });

  test('the server’s «reason required» reaches the screen in her words', async () => {
    mockRpc.mockResolvedValue({ data: null, error: refusal('serverErrors.reasonRequired') });

    const failure = await interruptCleaning(TASK_ID, '').catch((error: unknown) => error);

    expect(serverErrorText(failure).text).toBe('Укажите причину');
  });
});

describe('cancelCleaning', () => {
  test('calls cancel_cleaning with the cleaning and the office’s words', async () => {
    await cancelCleaning(TASK_ID, 'Гость продлил');

    expect(mockRpc).toHaveBeenCalledWith('cancel_cleaning', {
      p_task_id: TASK_ID,
      p_reason: 'Гость продлил',
    });
  });

  test('sends no reason when the office wrote none', async () => {
    await cancelCleaning(TASK_ID, null);

    expect(JSON.parse(JSON.stringify(mockRpc.mock.calls[0][1]))).toEqual({ p_task_id: TASK_ID });
  });

  test('a reason too long is said with its limit', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: refusal('serverErrors.reasonTooLong', JSON.stringify({ max: 500 })),
    });

    const failure = await cancelCleaning(TASK_ID, 'x').catch((error: unknown) => error);

    expect(serverErrorText(failure).text).toBe('Причина слишком длинная — не больше 500 знаков');
  });

  test('anybody but the office is refused', async () => {
    mockRpc.mockResolvedValue({ data: null, error: refusal('serverErrors.managerOnly') });

    await expect(cancelCleaning(TASK_ID, null)).rejects.toMatchObject({
      hint: 'serverErrors.managerOnly',
    });
  });
});
