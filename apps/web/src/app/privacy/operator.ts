// A build error, not a leak, if a client component ever imports this module.
import 'server-only';

/**
 * Where the operator's details come from: server-only environment variables,
 * never `NEXT_PUBLIC_*` and never the repository — it is public, and these are
 * the owner's own name, IČO, address and e-mail.
 *
 * To fill them: Vercel → the panel's project → Settings → Environment
 * Variables, each for Production and Preview, then redeploy (a deployment
 * reads the values it was started with). Locally: `apps/web/.env.local`.
 * A variable that is missing or blank leaves its bold placeholder on the page.
 */
export const OPERATOR_ENV = {
  name: 'PRIVACY_OPERATOR_NAME',
  id: 'PRIVACY_OPERATOR_ID',
  address: 'PRIVACY_OPERATOR_ADDRESS',
  email: 'PRIVACY_CONTACT_EMAIL',
} as const;

export type OperatorField = keyof typeof OPERATOR_ENV;

/** The operator as the policy names them; `null` for what is not given yet. */
export type OperatorDetails = Readonly<Record<OperatorField, string | null>>;

type Environment = Readonly<Record<string, string | undefined>>;

function given(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** Read at request time, on the server only. */
export function readOperator(env: Environment = process.env): OperatorDetails {
  return {
    name: given(env[OPERATOR_ENV.name]),
    id: given(env[OPERATOR_ENV.id]),
    address: given(env[OPERATOR_ENV.address]),
    email: given(env[OPERATOR_ENV.email]),
  };
}
