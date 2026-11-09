import path from "node:path";
import type { NextConfig } from "next";

/**
 * The panel lives in a monorepo: `@str-ops/shared` is a workspace package
 * shipped as raw TypeScript, so Next has to compile it, and the project
 * root is two levels up (Vercel builds from `apps/web`, where no lockfile
 * tells Turbopack where the workspace ends).
 */
const nextConfig: NextConfig = {
  transpilePackages: ["@str-ops/shared"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // The repository's own CLAUDE.md is the instruction set; a generated one
  // inside apps/web would compete with it.
  agentRules: false,
  // The OAuth consent page (docs/mcp-oauth.md) is never framed: «Allow» under
  // someone else's page would be clickjacking. Its query leaks to no referrer.
  async headers() {
    return [
      {
        source: "/oauth/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
