import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Vercel builds Next with its own adapter and treats `standalone` as
 * unnecessary, while a self-hosted target wants it so the image carries only
 * the traced files rather than the whole workspace. Setting it conditionally
 * lets one config serve both without a second file to keep in step.
 */
const isVercel = Boolean(process.env.VERCEL);

const config: NextConfig = {
  reactStrictMode: true,
  ...(isVercel ? {} : { output: "standalone" as const }),
  // fileURLToPath, not URL.pathname — the latter percent-encodes, so a project
  // path containing a space resolves to a directory that does not exist.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: ["@arca/core"],
};

export default config;
