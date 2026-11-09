import { NextResponse, type NextRequest } from 'next/server';

import { authorizationServerMetadata, requestOrigin } from '@/features/oauth/metadata';
import { publicEnv } from '@/lib/env';

/** How long a client may keep the metadata. */
const MAX_AGE_SECONDS = 300;

/**
 * RFC 8414 metadata of the MCP server's authorization server: the panel is
 * the issuer (docs/mcp-oauth.md). Open to anyone and any page — the proxy
 * lets it through without a session; it says nothing secret.
 */
export function GET(request: NextRequest) {
  const issuer = requestOrigin(request.headers, request.nextUrl.origin);
  return NextResponse.json(authorizationServerMetadata(issuer, publicEnv.supabaseUrl), {
    headers: {
      'Cache-Control': `public, max-age=${MAX_AGE_SECONDS}`,
      'Access-Control-Allow-Origin': '*',
    },
  });
}
