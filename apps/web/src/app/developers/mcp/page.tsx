import { translations } from '@str-ops/shared';
import type { Metadata } from 'next';

import { publicEnv } from '@/lib/env';

import { mcpPageLanguage } from './language';
import { McpGuide } from './mcp-guide';

interface McpPageProps {
  searchParams: Promise<{ lang?: string | string[] }>;
}

export async function generateMetadata({ searchParams }: McpPageProps): Promise<Metadata> {
  const language = mcpPageLanguage((await searchParams).lang);
  return { title: translations[language].developers.mcp.metaTitle };
}

/**
 * The MCP server's page, open to everyone like the API's reference: no
 * sign-in (`proxy.ts` lets `/developers/mcp` through) and no Supabase call;
 * the tools are built from the committed spec (docs/mcp-server.md §9).
 */
export default async function McpPage({ searchParams }: McpPageProps) {
  const language = mcpPageLanguage((await searchParams).lang);
  return <McpGuide language={language} supabaseUrl={publicEnv.supabaseUrl} />;
}
