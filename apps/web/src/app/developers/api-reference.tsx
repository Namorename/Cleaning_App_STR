'use client';

import dynamic from 'next/dynamic';

import { publicEnv } from '@/lib/env';

import { publicSpec } from './spec';

/** The route that serves the same spec as a file (`openapi.json/route.ts`). */
export const OPENAPI_FILE_HREF = '/developers/openapi.json';

const OPENAPI_FILE_NAME = 'woom-openapi-v1.json';

const LINK_CLASS = 'font-medium underline underline-offset-4 hover:text-muted-foreground';

/** Built once: the reference re-applies its configuration on every new object. */
const SPEC = publicSpec(publicEnv.supabaseUrl);

function LoadingReference() {
  return (
    <p role="status" className="px-4 py-6 text-muted-foreground sm:px-6">
      Loading the API reference…
    </p>
  );
}

/**
 * Scalar with its stylesheet, Vue inside, a few megabytes: fetched on this
 * page only, and in the browser only — it renders into the DOM it is given.
 */
const ScalarReference = dynamic(
  () => import('./scalar-reference').then((module) => module.ScalarReference),
  { ssr: false, loading: LoadingReference },
);

/** The page's head: the name and the spec as a file, for agents and client generators. */
function DevelopersHeader() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
      <p className="font-semibold">woom API v1</p>
      <a href={OPENAPI_FILE_HREF} download={OPENAPI_FILE_NAME} className={LINK_CLASS}>
        Download the OpenAPI file
      </a>
    </header>
  );
}

/** The public API's reference: the committed spec, its server set to this deployment's API. */
export function ApiReference() {
  return (
    <div className="flex flex-1 flex-col">
      <DevelopersHeader />
      {/* Not a <main>: Scalar renders its own. */}
      <div className="flex-1">
        <ScalarReference spec={SPEC} />
      </div>
    </div>
  );
}
