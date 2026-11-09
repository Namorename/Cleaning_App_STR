import { translations, type Language } from '@str-ops/shared';
import openapi from '@str-ops/shared/src/api/openapi.v1.json';
import coverageJson from '@str-ops/shared/src/api/coverage.json';
import { buildMcpCatalog, type McpTool } from '@str-ops/shared/src/api/mcp-tools';
import type { Coverage } from '@str-ops/shared/src/api/parity';
import { API_REGISTRY } from '@str-ops/shared/src/api/registry-data';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/page-header';

import { MCP_PAGE_LANGUAGES, mcpPageHref } from './language';

/** Where the MCP server answers under a Supabase project: the `mcp` Edge Function. */
export const MCP_FUNCTION_PATH = '/functions/v1/mcp';

const LINK_CLASS = 'font-medium underline underline-offset-4 hover:text-muted-foreground';
const CODE_CLASS =
  'overflow-x-auto rounded-md border bg-muted px-4 py-3 font-mono text-sm leading-relaxed';

/**
 * The tools as the server lists them, built once from the committed spec by
 * the same function `npm run api:docs` writes the Edge Function's copy with.
 */
const TOOLS: readonly McpTool[] = buildMcpCatalog({
  spec: openapi as Record<string, unknown>,
  registry: API_REGISTRY,
  coverage: coverageJson as Coverage,
}).tools;

export function mcpServerUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}${MCP_FUNCTION_PATH}`;
}

type Texts = (typeof translations)['en']['developers']['mcp'];

/** A scope's name as the key form in Settings → API says it. */
function scopeLabel(language: Language, scope: string): string {
  const [group, action] = scope.split(':');
  const scopes = translations[language].panel.settings.api.scopes as Record<
    string,
    Record<string, { label: string } | undefined> | undefined
  >;
  return scopes[group]?.[action]?.label ?? scope;
}

function Section({ id, heading, children }: { id: string; heading: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-xl font-semibold">
        {heading}
      </h2>
      {children}
    </section>
  );
}

/** A block that scrolls sideways on a phone: focusable, so a keyboard can scroll it too. */
function Code({ label, children }: { label: string; children: string }) {
  return (
    <pre tabIndex={0} aria-label={label} className={CODE_CLASS}>
      <code>{children}</code>
    </pre>
  );
}

function OtherLanguages({ language }: { language: Language }) {
  return (
    <nav aria-label={translations[language].developers.mcp.otherLanguages}>
      <ul className="flex flex-wrap gap-x-4">
        {MCP_PAGE_LANGUAGES.filter((other) => other !== language).map((other) => (
          <li key={other}>
            <Link
              href={mcpPageHref(other)}
              hrefLang={other}
              lang={other}
              className={`inline-flex min-h-11 items-center text-sm ${LINK_CLASS}`}
            >
              {translations[other].common.languages[other]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function clientConfigs(url: string) {
  return {
    claudeCodeOAuth: `claude mcp add --transport http woom ${url}`,
    claudeCode: `claude mcp add --transport http woom ${url} \\\n  --header "Authorization: Bearer $WOOM_API_KEY"`,
    mcpJson: JSON.stringify(
      {
        mcpServers: {
          woom: { type: 'http', url, headers: { Authorization: 'Bearer ${WOOM_API_KEY}' } },
        },
      },
      null,
      2,
    ),
    cursor: JSON.stringify(
      { mcpServers: { woom: { url, headers: { Authorization: 'Bearer ${env:WOOM_API_KEY}' } } } },
      null,
      2,
    ),
    desktop: JSON.stringify(
      {
        mcpServers: {
          woom: {
            command: 'npx',
            args: ['mcp-remote', url, '--header', 'Authorization:${AUTH_HEADER}'],
            env: { AUTH_HEADER: 'Bearer <your key>' },
          },
        },
      },
      null,
      2,
    ),
  };
}

function ToolsTable({ language, texts }: { language: Language; texts: Texts }) {
  return (
    <div tabIndex={0} role="region" aria-label={texts.toolsHeading} className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{texts.toolsHeading}</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="py-2 pr-4 font-semibold">
              {texts.toolColumn}
            </th>
            <th scope="col" className="py-2 pr-4 font-semibold">
              {texts.scopeColumn}
            </th>
            <th scope="col" className="py-2 font-semibold">
              {texts.kindColumn}
            </th>
          </tr>
        </thead>
        <tbody>
          {TOOLS.map((tool) => (
            <tr key={tool.name} className="border-b align-top">
              <td className="py-2 pr-4">
                <code className="font-mono">{tool.name}</code>
                <div className="text-muted-foreground">{tool.title}</div>
              </td>
              <td className="py-2 pr-4">
                {tool.scope === null ? (
                  texts.anyKey
                ) : (
                  <>
                    <div>{scopeLabel(language, tool.scope)}</div>
                    <code className="font-mono text-muted-foreground">{tool.scope}</code>
                  </>
                )}
              </td>
              <td className="py-2">{tool.kind === 'write' ? texts.kindWrite : texts.kindRead}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface McpGuideProps {
  language: Language;
  /** NEXT_PUBLIC_SUPABASE_URL of the project this panel runs against. */
  supabaseUrl: string;
}

/** The MCP server's page for developers: where it is, how to connect, what a key allows. */
export function McpGuide({ language, supabaseUrl }: McpGuideProps) {
  const texts = translations[language].developers.mcp;
  const url = mcpServerUrl(supabaseUrl);
  const configs = clientConfigs(url);

  return (
    <main
      lang={language}
      className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6"
    >
      {/* The panel's one h1 writer (components/page-header.tsx), as the privacy page has it. */}
      <PageHeader title={texts.title} actions={<OtherLanguages language={language} />} />
      <div className="flex flex-col gap-3">
        <p>{texts.intro}</p>
        <p>
          <Link href="/developers" className={LINK_CLASS}>
            {texts.apiReference}
          </Link>
        </p>
      </div>

      <Section id="mcp-endpoint" heading={texts.endpointHeading}>
        <Code label={texts.endpointHeading}>{url}</Code>
        <p>{texts.endpointText}</p>
      </Section>

      <Section id="mcp-key" heading={texts.keyHeading}>
        <p role="note" className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3">
          {texts.keyText}
        </p>
      </Section>

      {/* docs/mcp-oauth.md: the Claude apps sign in by OAuth, no key; a key stays the way for the rest. */}
      <Section id="mcp-clients" heading={texts.clientsHeading}>
        <h3 className="font-semibold">claude.ai</h3>
        <p>{texts.claudeAiText}</p>
        <h3 className="font-semibold">Claude Desktop</h3>
        <p>{texts.desktopText}</p>
        <Code label="Claude Desktop">{configs.desktop}</Code>
        <h3 className="font-semibold">Claude Code</h3>
        <p>{texts.claudeCodeText}</p>
        <Code label="Claude Code (OAuth)">{configs.claudeCodeOAuth}</Code>
        <p>{texts.claudeCodeKeyText}</p>
        <Code label="Claude Code (API key)">{configs.claudeCode}</Code>
        <p>{texts.claudeCodeProject}</p>
        <Code label=".mcp.json">{configs.mcpJson}</Code>
        <h3 className="font-semibold">Cursor</h3>
        <p>{texts.cursorText}</p>
        <Code label="Cursor">{configs.cursor}</Code>
      </Section>

      <Section id="mcp-tools" heading={texts.toolsHeading}>
        <p>{texts.toolsText}</p>
        <ToolsTable language={language} texts={texts} />
      </Section>

      <Section id="mcp-data" heading={texts.dataHeading}>
        <p>{texts.dataText}</p>
      </Section>

      <Section id="mcp-writes" heading={texts.writesHeading}>
        <p>{texts.writesText}</p>
      </Section>

      <Section id="mcp-examples" heading={texts.examplesHeading}>
        <ul className="list-disc pl-6">
          <li>{texts.example1}</li>
          <li>{texts.example2}</li>
          <li>{texts.example3}</li>
        </ul>
      </Section>
    </main>
  );
}
