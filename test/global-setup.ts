import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { join } from "node:path";

const migrationsPath = join(import.meta.dirname, "..", "migrations");

// Vitest 4 globalSetup: the default export receives the TestProject instance.
// Use TestProject.provide() to pass data to Workers-pool setup files via inject().
export default async function setup(project: { provide: (key: string, value: unknown) => void }) {
  const migrations = await readD1Migrations(migrationsPath);
  project.provide("d1Migrations", migrations);
}
