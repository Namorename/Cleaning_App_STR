import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ConsentRequest } from '../authorize-request';

const CODE = `woomcd_${'ab'.repeat(32)}`;
const rpc = vi.fn();

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({ rpc }) }));
vi.mock('@/features/team/use-team', () => ({
  useProperties: () => ({
    data: [
      { id: 101, name: 'Main House' },
      { id: 102, name: 'Flat Two' },
    ],
    isPending: false,
  }),
}));

import { ConsentFailed, ConsentForm } from '../consent-form';

const REQUEST: ConsentRequest = {
  clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
  clientName: 'Claude',
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  redirectLabel: 'claude.ai',
  isLoopback: false,
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  resource: 'https://project.supabase.co/functions/v1/mcp',
  state: 'st-1',
  issuer: 'https://woom-bnb.vercel.app',
};

function renderForm(props: { request?: ConsentRequest; isAdmin?: boolean } = {}) {
  const navigate = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ConsentForm
        request={props.request ?? REQUEST}
        isAdmin={props.isAdmin ?? true}
        navigate={navigate}
      />
    </QueryClientProvider>,
  );
  return { navigate };
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { code: CODE }, error: null });
});

describe('the consent page', () => {
  test('says who asks and where the browser goes back', () => {
    renderForm();
    expect(screen.getByRole('heading', { name: 'Подключение к woom' })).toBeInTheDocument();
    expect(
      screen.getByText('Claude просит доступ к данным вашей компании в woom.'),
    ).toBeInTheDocument();
    expect(screen.getByText('После ответа браузер вернётся на claude.ai.')).toBeInTheDocument();
  });

  test('offers read only and operator, never full access or a custom set', () => {
    renderForm();
    const presets = screen
      .getAllByRole('radio')
      .map((radio) => radio.closest('div')?.textContent ?? '');
    expect(presets).toHaveLength(2);
    expect(presets[0]).toMatch(/^Только чтение/);
    expect(presets[1]).toMatch(/^Оператор/);
  });

  test('«Allow» records the choice and sends the browser back with the code, the state and the issuer', async () => {
    const { navigate } = renderForm();
    await userEvent.click(screen.getByRole('radio', { name: /Оператор/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Разрешить' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith(
      'oauth_authorize',
      expect.objectContaining({
        p_client_id: REQUEST.clientId,
        p_client_name: 'Claude',
        p_redirect_uri: REQUEST.redirectUri,
        p_code_challenge: REQUEST.codeChallenge,
        p_resource: REQUEST.resource,
        p_name: 'Claude',
        p_preset: 'operator',
        p_property_ids: null,
      }),
    );
    const back = new URL(navigate.mock.calls[0][0] as string);
    expect(`${back.origin}${back.pathname}`).toBe(REQUEST.redirectUri);
    expect(Object.fromEntries(back.searchParams)).toEqual({
      code: CODE,
      state: 'st-1',
      iss: REQUEST.issuer,
    });
  });

  test('«Deny» sends the browser back with access_denied, recording nothing', async () => {
    const { navigate } = renderForm();
    await userEvent.click(screen.getByRole('link', { name: 'Отказать' }));

    expect(rpc).not.toHaveBeenCalled();
    const back = new URL(navigate.mock.calls[0][0] as string);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('st-1');
    expect(back.searchParams.get('iss')).toBe(REQUEST.issuer);
  });

  test('a refusal of the database stays on the page, translated', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'Only an admin may manage API keys',
        hint: 'serverErrors.adminOnly',
        details: '',
      },
    });
    const { navigate } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Разрешить' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  test('somebody who is not an admin may only deny', () => {
    renderForm({ isAdmin: false });
    expect(screen.queryByRole('button', { name: 'Разрешить' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Подключать помощников может только админ компании/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Отказать' })).toBeInTheDocument();
  });

  test('an answer bound for this computer is warned about', () => {
    renderForm({
      request: {
        ...REQUEST,
        redirectUri: 'http://localhost:3118/callback',
        redirectLabel: 'localhost:3118',
        isLoopback: true,
      },
    });
    expect(screen.getByText(/Ответ уйдёт программе на этом компьютере/)).toBeInTheDocument();
  });

  test('a request the page will not answer is explained, with nowhere to go', () => {
    render(<ConsentFailed reason="badRedirect" />);
    expect(
      screen.getByRole('heading', { name: 'Подключение не удалось начать' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
