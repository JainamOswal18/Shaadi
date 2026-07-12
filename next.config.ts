import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project (worktrees create sibling lockfiles).
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Native / binary packages must NOT be bundled — they are required at runtime
  // from node_modules. Bundling them makes the tracer walk their binary dirs
  // (and, via the pinned root, the local .venv), which breaks the build.
  serverExternalPackages: ["sharp", "ffmpeg-static", "archiver", "onnxruntime-node"],
  // Never trace local-only, non-deployed directories into the serverless output.
  outputFileTracingExcludes: {
    "*": [
      ".venv/**",
      ".wt/**",
      "ingest/**",
      "api/embed/models/**",
      "docs/**",
      ".superpowers/**",
      "**/*.py",
    ],
  },
};

export default nextConfig;
