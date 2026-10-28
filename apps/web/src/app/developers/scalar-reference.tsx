'use client';

import {
  ApiReferenceReact,
  type AnyApiReferenceConfiguration,
} from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import { useMemo, useState } from 'react';

import type { OpenApiDocument } from './spec';

/** One document's configuration, as the wrapper takes it (not a list of them). */
export type ScalarConfiguration = Exclude<AnyApiReferenceConfiguration, readonly unknown[]>;

/** The spec's one security scheme (`components.securitySchemes`). */
const BEARER_SCHEME = 'bearerAuth';

type ColorMode = 'dark' | 'light';

/**
 * The panel's theme as the root layout put it on <html>: `dark` or `light`
 * when the reader chose one, nothing while the system decides.
 */
export function panelColorMode(doc: Document): ColorMode | undefined {
  const { classList } = doc.documentElement;
  if (classList.contains('dark')) {
    return 'dark';
  }
  if (classList.contains('light')) {
    return 'light';
  }
  return undefined;
}

/**
 * Scalar as the page needs it: nothing leaves for Scalar's own services, and
 * the key a reader types stays in the page's memory only.
 *
 * - No `proxyUrl`: the reference's client runs in the `modal` layout, whose
 *   default is no proxy, so "Test request" goes straight to the API (CORS `*`).
 * - `withDefaultFonts: false`: no fonts from fonts.scalar.com.
 * - `telemetry: false`, and no analytics plugin is loaded at all.
 * - `persistAuth: false`: the token is not written to localStorage.
 * - The AI agent, the MCP button, the developer tools and the "Open in API
 *   Client" link (client.scalar.com) are off.
 * - Bearer auth is preselected with no token: without a key the API answers
 *   401 problem+json, as it should.
 * - The panel's theme wins when the reader chose one; with none, Scalar
 *   follows the system as the panel does. No toggle: the panel's setting is
 *   the one place to change it.
 */
export function scalarConfiguration(
  spec: OpenApiDocument,
  colorMode: ColorMode | undefined,
): ScalarConfiguration {
  return {
    content: spec,
    authentication: { preferredSecurityScheme: BEARER_SCHEME },
    persistAuth: false,
    withDefaultFonts: false,
    telemetry: false,
    agent: { disabled: true },
    mcp: { disabled: true },
    hideClientButton: true,
    showDeveloperTools: 'never',
    hideDarkModeToggle: true,
    forceDarkModeState: colorMode,
  };
}

interface ScalarReferenceProps {
  spec: OpenApiDocument;
}

/**
 * The reference itself. Loaded by `next/dynamic` without SSR, so it renders in
 * the browser only and `document` is there to read.
 */
export function ScalarReference({ spec }: ScalarReferenceProps) {
  const [colorMode] = useState(() => panelColorMode(document));
  // One object for the page's life: the wrapper re-applies the configuration
  // whenever its identity changes.
  const configuration = useMemo(() => scalarConfiguration(spec, colorMode), [spec, colorMode]);

  return <ApiReferenceReact configuration={configuration} />;
}
