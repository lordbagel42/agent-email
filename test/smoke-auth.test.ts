import { SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { setupDatabase } from "./setup";

const BASE = "https://email.agent.raygen.dev";

beforeAll(async () => {
  await setupDatabase();
});

// Regression guard: better-auth keeps only the LAST plugin endpoint registered
// under a given object key. Both device-authorization and agent-auth expose a
// `deviceCode` endpoint, so plugin order in src/auth.ts decides whether the
// human-CLI login route (/api/auth/device/code) survives. If someone reorders
// the plugins so agent-auth comes last, this test goes back to 404/500.
describe("auth schema smoke", () => {
  it("device/code writes to deviceCode table and returns a user_code", async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "agent-email-cli" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ user_code?: string; device_code?: string }>();
    expect(body.user_code).toBeTruthy();
    expect(body.device_code).toBeTruthy();
  });

  it("serves the agent-auth discovery document", async () => {
    const res = await SELF.fetch(`${BASE}/.well-known/agent-configuration`);
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    expect(JSON.stringify(body)).toMatch(/issuer|endpoints|capabilit/i);
  });
});
