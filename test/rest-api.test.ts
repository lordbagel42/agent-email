import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { setupDatabase } from "./setup";

beforeAll(async () => {
  await setupDatabase();
});

beforeEach(async () => {
  await env.DB.exec("DELETE FROM received_emails");
  await env.DB.exec("DELETE FROM temp_emails");
  // Clean up better-auth session/account tables between tests
  await env.DB.exec("DELETE FROM session");
  await env.DB.exec("DELETE FROM account");
  await env.DB.exec("DELETE FROM \"user\"");
});

async function signUpAndToken(): Promise<string> {
  // requireEmailVerification is on, so sign-up does NOT auto-create a session.
  // Simulate admin approval by flipping emailVerified in the DB, then sign in
  // to obtain a bearer session token (the same path a verified user takes).
  const email = `u${crypto.randomUUID().slice(0, 8)}@example.com`;
  const signup = await SELF.fetch("https://email.agent.raygen.dev/api/auth/sign-up/email", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password12345", name: "u" }),
  });
  expect(signup.ok).toBe(true);
  await env.DB.prepare(`UPDATE "user" SET emailVerified = 1 WHERE email = ?`).bind(email).run();

  const signin = await SELF.fetch("https://email.agent.raygen.dev/api/auth/sign-in/email", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password12345" }),
  });
  expect(signin.ok).toBe(true);
  const token = signin.headers.get("set-auth-token");
  expect(token).toBeTruthy();
  return token!;
}

describe("REST API auth", () => {
  it("rejects unauthenticated access", async () => {
    const res = await SELF.fetch("https://email.agent.raygen.dev/api/emails");
    expect(res.status).toBe(401);
  });

  it("creates and lists an address for the authed user", async () => {
    const token = await signUpAndToken();
    const auth = { authorization: `Bearer ${token}` };
    const create = await SELF.fetch("https://email.agent.raygen.dev/api/emails", {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ prefix: "test", ttl_minutes: 30 }),
    });
    expect(create.status).toBe(201);
    const { address } = await create.json<{ address: string }>();
    expect(address).toMatch(/^e-test-/);
    const list = await SELF.fetch("https://email.agent.raygen.dev/api/emails", { headers: auth });
    const body = await list.json<{ addresses: { address: string }[] }>();
    expect(body.addresses.map((a) => a.address)).toContain(address);
  });
});
