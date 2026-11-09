import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { fetchRegisteredClient } from '@/features/oauth/api';
import { readAuthorizeRequest, type SearchParams } from '@/features/oauth/authorize-request';
import {
  fetchClientMetadata,
  isClientIdUrl,
  type OAuthClient,
} from '@/features/oauth/client-metadata';
import { ConsentFailed, ConsentForm } from '@/features/oauth/consent-form';
import { mcpResource, oauthIssuer } from '@/features/oauth/metadata';
import { publicEnv } from '@/lib/env';
import { roleOf } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'woom',
  robots: { index: false, follow: false },
};

interface AuthorizePageProps {
  searchParams: Promise<SearchParams>;
}

/**
 * The authorization endpoint (docs/mcp-oauth.md): an assistant sends the
 * admin's browser here to connect to the MCP server. The proxy has already
 * made the visitor sign in (and brings him back here with the whole query).
 * The request is read on the server — the client's document fetched, its
 * redirect checked — before anything is shown; the card itself asks what the
 * connection may do.
 */
export default async function AuthorizePage({ searchParams }: AuthorizePageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const issuer = oauthIssuer();

  const lookupClient = async (clientId: string): Promise<OAuthClient | null> => {
    if (isClientIdUrl(clientId)) {
      return fetchClientMetadata(clientId);
    }
    return /^woomc_[0-9a-f]{32}$/.test(clientId) ? fetchRegisteredClient(supabase, clientId) : null;
  };

  const outcome = await readAuthorizeRequest(params, {
    issuer,
    resource: mcpResource(publicEnv.supabaseUrl),
    lookupClient,
  });
  if (outcome.kind === 'redirect') {
    redirect(outcome.to);
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      {outcome.kind === 'invalid' ? (
        <ConsentFailed reason={outcome.reason} />
      ) : (
        <ConsentForm request={outcome.request} isAdmin={roleOf(user) === 'admin'} />
      )}
    </main>
  );
}
