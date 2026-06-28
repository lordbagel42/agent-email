import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { makeOnExecute } from "../src/capabilities";
import { listTempEmails } from "../src/email-service";
import { setupDatabase } from "./setup";

beforeAll(async () => {
  await setupDatabase();
});

beforeEach(async () => {
  await env.DB.exec("DELETE FROM received_emails");
  await env.DB.exec("DELETE FROM temp_emails");
});

function session(userId: string) {
  return { user: { id: userId }, userId, agentId: "a1", agent: { id: "a1" } } as any;
}

describe("makeOnExecute", () => {
  it("create_temp_email creates an address for the agent's user", async () => {
    const onExecute = makeOnExecute(env);
    const out = await onExecute({ capability: "create_temp_email", arguments: { prefix: "x" }, agentSession: session("u1") } as any);
    expect((out as any).address).toMatch(/^e-x-[a-z0-9]{12}@agent\.raygen\.dev$/);
    expect(await listTempEmails(env, "u1")).toHaveLength(1);
  });

  it("throws on unknown capability", async () => {
    const onExecute = makeOnExecute(env);
    await expect(onExecute({ capability: "nope", agentSession: session("u1") } as any)).rejects.toThrow();
  });

  it("throws when the agent has no resolved user", async () => {
    const onExecute = makeOnExecute(env);
    await expect(onExecute({ capability: "list_temp_emails", agentSession: { user: null, userId: null } } as any)).rejects.toThrow();
  });
});
