import openapi from '@str-ops/shared/src/api/openapi.v1.json';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { ScalarConfiguration } from '../scalar-reference';

// Scalar itself (Vue inside, megabytes) never loads here: the stand-in keeps
// every configuration it is handed, which is all the page decides.
const scalar = vi.hoisted(() => ({ configurations: [] as unknown[] }));
vi.mock('@scalar/api-reference-react', () => ({
  ApiReferenceReact: ({ configuration }: { configuration: unknown }) => {
    scalar.configurations.push(configuration);
    return <div data-testid="scalar-reference" />;
  },
}));
vi.mock('@scalar/api-reference-react/style.css', () => ({}));

import DevelopersPage, { metadata } from '../page';

/** vitest.setup.ts: the project the panel runs against in the tests. */
const API_URL = 'https://project.supabase.co/functions/v1/api';

interface RenderedSpec {
  servers: unknown;
  paths: Record<string, unknown>;
  info: { title: string };
}

/** Render the page and wait for the reference, which loads after the first paint. */
async function renderedConfiguration(): Promise<ScalarConfiguration> {
  render(<DevelopersPage />);
  await screen.findByTestId('scalar-reference');
  return scalar.configurations.at(-1) as ScalarConfiguration;
}

beforeEach(() => {
  scalar.configurations = [];
});

afterEach(() => {
  document.documentElement.classList.remove('dark', 'light');
});

describe('the developers page', () => {
  test('names the tab in English, the product language', () => {
    expect(metadata.title).toBe('woom API v1');
  });

  test('links the spec as a file, above the reference', () => {
    render(<DevelopersPage />);

    const link = screen.getByRole('link', { name: 'Download the OpenAPI file' });
    expect(link).toHaveAttribute('href', '/developers/openapi.json');
    expect(link).toHaveAttribute('download');
  });

  test('says the reference is loading before Scalar arrives', () => {
    render(<DevelopersPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading the API reference…');
  });

  test('renders the committed spec with its server set to this project’s API', async () => {
    const configuration = await renderedConfiguration();
    const spec = configuration.content as RenderedSpec;

    expect(spec.servers).toEqual([{ url: API_URL, description: 'woom API' }]);
    expect(spec.info.title).toBe(openapi.info.title);
    expect(Object.keys(spec.paths)).toContain('/v1/cleanings');
    expect(Object.keys(spec.paths)).toEqual(Object.keys(openapi.paths));
  });

  test('leaves the imported spec as committed', async () => {
    const committedServers = structuredClone(openapi.servers);

    await renderedConfiguration();

    expect(openapi.servers).toEqual(committedServers);
  });

  test('sends nothing to Scalar’s services and keeps no key', async () => {
    const configuration = await renderedConfiguration();

    expect(configuration).not.toHaveProperty('proxyUrl');
    expect(configuration).not.toHaveProperty('proxy');
    expect(configuration.withDefaultFonts).toBe(false);
    expect(configuration.telemetry).toBe(false);
    expect(configuration.persistAuth).toBe(false);
    expect(configuration.agent).toEqual({ disabled: true });
    expect(configuration.mcp).toEqual({ disabled: true });
    expect(configuration.hideClientButton).toBe(true);
    expect(configuration.showDeveloperTools).toBe('never');
  });

  test('keeps "Test request" and preselects the bearer key with no token', async () => {
    const configuration = await renderedConfiguration();

    expect(configuration.hideTestRequestButton).not.toBe(true);
    expect(configuration.authentication).toEqual({ preferredSecurityScheme: 'bearerAuth' });
    expect(Object.keys(openapi.components.securitySchemes)).toEqual(['bearerAuth']);
  });

  test.each([
    ['dark', 'dark'],
    ['light', 'light'],
  ] as const)('follows the panel’s %s theme', async (panelClass, mode) => {
    document.documentElement.classList.add(panelClass);

    const configuration = await renderedConfiguration();

    expect(configuration.forceDarkModeState).toBe(mode);
    expect(configuration.hideDarkModeToggle).toBe(true);
  });

  test('leaves the mode to the system when the panel does', async () => {
    const configuration = await renderedConfiguration();

    expect(configuration.forceDarkModeState).toBeUndefined();
  });
});
