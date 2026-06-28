import { describe, it, expect, vi } from "vitest";
import { ApiClient, ApiError } from "../src/client";

describe("ApiClient", () => {
  it("sends bearer header and parses JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const c = new ApiClient({ baseUrl: "https://x", token: "t" }, fetchMock as any);
    const out = await c.get<{ ok: boolean }>("/api/emails");
    expect(out.ok).toBe(true);
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer t");
  });
  it("throws ApiError with status on non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "nope" }), { status: 401, headers: { "content-type": "application/json" } }));
    const c = new ApiClient({ baseUrl: "https://x", token: "t" }, fetchMock as any);
    await expect(c.get("/api/emails")).rejects.toMatchObject({ status: 401 });
  });
});
