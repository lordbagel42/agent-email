import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { setupDatabase } from "./setup";
import { ADMIN_EMAIL } from "../src/auth";

const BASE = "https://email.agent.raygen.dev";

beforeAll(async () => {
  await setupDatabase();
});
beforeEach(async () => {
  await env.DB.exec("DELETE FROM session");
  await env.DB.exec("DELETE FROM account");
  await env.DB.exec('DELETE FROM "user"');
});

async function signUp(email: string) {
  return SELF.fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password12345", name: "x" }),
  });
}
async function signIn(email: string) {
  return SELF.fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password12345" }),
  });
}

describe("email verification gate", () => {
  it("blocks sign-in for a freshly signed-up (unverified) user", async () => {
    expect((await signUp("nobody@example.com")).ok).toBe(true);
    const res = await signIn("nobody@example.com");
    expect(res.ok).toBe(false); // EMAIL_NOT_VERIFIED
  });

  it("hardcoded admin email is auto-verified + admin role and can sign in", async () => {
    expect((await signUp(ADMIN_EMAIL)).ok).toBe(true);
    const row = await env.DB.prepare(
      'SELECT emailVerified, role FROM "user" WHERE email = ?',
    ).bind(ADMIN_EMAIL).first<{ emailVerified: number; role: string }>();
    expect(row?.emailVerified).toBeTruthy();
    expect(row?.role).toBe("admin");
    expect((await signIn(ADMIN_EMAIL)).ok).toBe(true);
  });
});
