import { describe, it, expect, vi } from "vitest";
import { passwordSignIn, signUp } from "../src/password-auth";

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("passwordSignIn", () => {
  it("returns the bearer token on success", async () => {
    const fetchMock = vi.fn(async () => res(200, { user: {} }, { "set-auth-token": "tok123" }));
    const r = await passwordSignIn("https://x", "a@b.com", "password12345", fetchMock as any);
    expect(r).toEqual({ status: "ok", token: "tok123" });
  });

  it("reports unverified on 403 EMAIL_NOT_VERIFIED", async () => {
    const fetchMock = vi.fn(async () => res(403, { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" }));
    const r = await passwordSignIn("https://x", "a@b.com", "password12345", fetchMock as any);
    expect(r).toEqual({ status: "unverified" });
  });

  it("throws on bad credentials", async () => {
    const fetchMock = vi.fn(async () => res(401, { message: "Invalid email or password" }));
    await expect(passwordSignIn("https://x", "a@b.com", "nope", fetchMock as any)).rejects.toThrow(/invalid/i);
  });
});

describe("signUp", () => {
  it("resolves on 2xx", async () => {
    const fetchMock = vi.fn(async () => res(200, { user: {} }));
    await expect(signUp("https://x", "a@b.com", "password12345", fetchMock as any)).resolves.toBeUndefined();
  });
  it("throws with the server message on failure", async () => {
    const fetchMock = vi.fn(async () => res(422, { message: "Password too short" }));
    await expect(signUp("https://x", "a@b.com", "x", fetchMock as any)).rejects.toThrow(/too short/i);
  });
});
