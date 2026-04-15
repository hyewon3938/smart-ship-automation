import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "playwright"],
  outputFileTracingExcludes: {
    "*": [
      "node_modules/playwright-core/.local-browsers/**",
      "node_modules/@playwright/test/**",
      "node_modules/typescript/**",
      "node_modules/@types/**",
      "data/**",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
  },
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        {
          key: "Service-Worker-Allowed",
          value: "/",
        },
        {
          key: "Cache-Control",
          value: "no-cache",
        },
      ],
    },
  ],
};

export default nextConfig;
