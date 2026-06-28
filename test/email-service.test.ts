import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  createTempEmail, listTempEmails, deleteTempEmail,
  listMessages, readMessage, storeInbound, purgeExpired,
} from "../src/email-service";
import { setupDatabase } from "./setup";

beforeAll(async () => {
  await setupDatabase();
});

beforeEach(async () => {
  await env.DB.exec("DELETE FROM received_emails");
  await env.DB.exec("DELETE FROM temp_emails");
});

describe("createTempEmail", () => {
  it("creates an e-<tag> address scoped to the user", async () => {
    const res = await createTempEmail(env, "user1", { prefix: "signup", ttlMinutes: 60 });
    expect(res.address).toMatch(/^e-signup-[a-z0-9]{12}@agent\.raygen\.dev$/);
    const list = await listTempEmails(env, "user1");
    expect(list.map((r) => r.address)).toContain(res.address);
  });

  it("clamps ttl to 1440 and uses random tag when no prefix", async () => {
    const res = await createTempEmail(env, "user1", { ttlMinutes: 99999 });
    expect(res.address).toMatch(/^e-[a-z0-9]{12}@agent\.raygen\.dev$/);
    const ttlMs = new Date(res.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(1440 * 60 * 1000 + 1000);
  });
});

describe("ownership", () => {
  it("does not list another user's address", async () => {
    const a = await createTempEmail(env, "user1", {});
    const list = await listTempEmails(env, "user2");
    expect(list.map((r) => r.address)).not.toContain(a.address);
  });

  it("deleteTempEmail returns false for non-owner", async () => {
    const a = await createTempEmail(env, "user1", {});
    expect(await deleteTempEmail(env, "user2", a.address)).toBe(false);
    expect(await deleteTempEmail(env, "user1", a.address)).toBe(true);
  });
});

describe("messages + inbound + purge", () => {
  it("stores inbound only for active addresses and reads it back", async () => {
    const { address } = await createTempEmail(env, "user1", {});
    expect(await storeInbound(env, { recipient: address, sender: "a@x.com", subject: "Hi", text: "body", html: null, messageId: "m1" })).toBe("stored");
    expect(await storeInbound(env, { recipient: "e-nope@agent.raygen.dev", sender: "a@x.com", subject: "x", text: null, html: null, messageId: null })).toBe("rejected");
    const msgs = await listMessages(env, "user1", address);
    expect(msgs).toHaveLength(1);
    const full = await readMessage(env, "user1", msgs![0].id);
    expect(full?.body_text).toBe("body");
    expect(await readMessage(env, "user2", msgs![0].id)).toBeNull();
  });

  it("purgeExpired removes expired addresses + their messages", async () => {
    await env.DB.prepare(
      `INSERT INTO temp_emails (address, user_id, created_at, expires_at)
       VALUES ('e-old@agent.raygen.dev','user1',datetime('now','-2 hours'),datetime('now','-1 hour'))`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO received_emails (recipient,sender,subject,received_at) VALUES ('e-old@agent.raygen.dev','a@x.com','s',datetime('now'))`,
    ).run();
    const removed = await purgeExpired(env);
    expect(removed).toBe(1);
    const { results } = await env.DB.prepare(`SELECT COUNT(*) c FROM received_emails WHERE recipient='e-old@agent.raygen.dev'`).all<{c:number}>();
    expect(results[0].c).toBe(0);
  });
});
