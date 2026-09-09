import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repository's own CLAUDE.md is the instruction set; a generated one
  // inside apps/web would compete with it.
  agentRules: false,
};

export default nextConfig;
