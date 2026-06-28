// This module is imported by test files to apply D1 migrations before tests run.
// It runs inside the Workers runtime, so cloudflare:test is available.
import { env, applyD1Migrations } from "cloudflare:test";
import { inject } from "vitest";

export async function setupDatabase() {
  const migrations = inject("d1Migrations");
  await applyD1Migrations(env.DB, migrations);
}
