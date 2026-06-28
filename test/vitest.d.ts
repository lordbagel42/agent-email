import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// Augment vitest's ProvidedContext so inject("d1Migrations") is typed correctly.
declare module "vitest" {
  interface ProvidedContext {
    d1Migrations: D1Migration[];
  }
}
