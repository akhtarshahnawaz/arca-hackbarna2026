import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Standalone keeps the Railway image small: Next traces exactly the files the
  // server needs rather than shipping the whole node_modules tree.
  output: "standalone",
  // fileURLToPath, not URL.pathname — the latter percent-encodes, so a project
  // path containing a space resolves to a directory that does not exist.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: ["@arca/core"],
};

export default config;
