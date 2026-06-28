import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // main is required to use SELF in integration tests
      main: "./src/index.ts",
      miniflare: {
        d1Databases: ["DB"],
        // Provide a test secret for better-auth
        bindings: {
          AUTH_SECRET: "test-secret-for-vitest-only-not-production-use",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
  },
});
