import { describe, it, expect, vi } from "vitest";
import { pollDeviceToken } from "../src/device";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("pollDeviceToken", () => {
  it("returns token once approved, honoring authorization_pending", async () => {
    const seq = [
      jsonResponse(400, { error: "authorization_pending" }),
      jsonResponse(200, { access_token: "tok", token_type: "bearer" }),
    ];
    const fetchMock = vi.fn(async () => seq.shift()!);
    const tok = await pollDeviceToken("https://x", "dev", "cli", 0, fetchMock as any, () => Promise.resolve());
    expect(tok).toBe("tok");
  });
  it("throws on expired_token", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(400, { error: "expired_token" }));
    await expect(pollDeviceToken("https://x", "dev", "cli", 0, fetchMock as any, () => Promise.resolve())).rejects.toThrow(/expired/);
  });
});
