import { describe, it, expect, vi } from "vitest";
import { runReceive } from "../src/commands/receive";

function fakeClient(messages: any[][]) {
  const calls: string[] = [];
  return {
    calls,
    post: vi.fn(async () => ({ address: "e-x-abc@agent.raygen.dev", expiresAt: "" })),
    get: vi.fn(async (p: string) => {
      calls.push("GET " + p);
      if (p.includes("/messages")) return { messages: messages.shift() ?? [] };
      return {};
    }),
    del: vi.fn(async (p: string) => { calls.push("DEL " + p); return { deleted: true }; }),
  };
}

describe("runReceive", () => {
  it("deletes the address after receiving a message", async () => {
    const client = fakeClient([[], [{ id: 1, sender: "a@x", subject: "hi", received_at: "" }]]);
    await runReceive(client as any, { pollMs: 1, timeoutMs: 5000 });
    expect(client.del).toHaveBeenCalledWith("/api/emails/e-x-abc%40agent.raygen.dev");
  });
  it("deletes the address even on timeout (no message)", async () => {
    const client = fakeClient([[], [], []]);
    await runReceive(client as any, { pollMs: 1, timeoutMs: 3 });
    expect(client.del).toHaveBeenCalled();
  });
});
