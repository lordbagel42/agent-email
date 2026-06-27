# Agent Email — Agent Auth + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `cf-email-mcp` Worker to authenticate agents with `@better-auth/agent-auth` (capabilities + approval + signed JWTs), funnel all email logic through one shared module, and ship a containerized `agent-email` CLI for humans.

**Architecture:** A Hono Worker exposes (a) better-auth at `/api/auth/*` with `agentAuth` + `deviceAuthorization` + `bearer` plugins, (b) an agent-auth discovery doc at `/.well-known/agent-configuration`, (c) a session-protected REST API for the CLI, and (d) three minimal HTML approval pages. All email operations live in `email-service.ts`, called by the agent `onExecute` handler, the REST API, and the inbound `email()` handler. A Node CLI logs in via the OAuth Device grant and is published as a Docker image to GHCR.

**Tech Stack:** Cloudflare Workers, Hono, D1, better-auth 1.6.22, @better-auth/agent-auth 0.6.2, Vitest + @cloudflare/vitest-pool-workers, Node + commander, Docker/GHCR.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/email-service.ts` | Pure D1 operations: create/list/delete temp addresses, list/read messages, store inbound, purge expired. The single source of truth. |
| `src/capabilities.ts` | Agent-auth capability definitions (JSON Schema input) + `makeOnExecute(env)` dispatcher → `email-service`. |
| `src/auth.ts` | `createAuth(env)` wiring `emailAndPassword`, `agentAuth`, `deviceAuthorization`, `bearer`. |
| `src/rest-api.ts` | Hono sub-router (`/api/emails*`, `/api/messages/*`), session/bearer-protected, thin over `email-service`. |
| `src/email-handler.ts` | Inbound mail → `email-service.storeInbound`; reject unknown/expired. |
| `src/index.ts` | Root Hono app: mounts auth, REST, discovery, pages; `scheduled` cron → `purgeExpired`. |
| `public/sign-in.html` | Email/password login + signup toggle. |
| `public/device.html` | Human CLI device-code approval. |
| `public/agent-approval.html` | Agent capability-grant approval. |
| `migrations/0002_agent_auth.sql` | Tables for agent-auth + device-authorization plugins. |
| `test/email-service.test.ts` | Unit tests for `email-service` (vitest-pool-workers, real D1). |
| `test/rest-api.test.ts` | Tests for REST routes incl. auth + ownership. |
| `cli/package.json` | CLI package (`bin: agent-email`), commander dep. |
| `cli/src/config.ts` | Token/baseUrl resolution (flag → env → file), 0600 writes. |
| `cli/src/client.ts` | `fetch` wrapper: bearer header, JSON, error mapping, 401 handling. |
| `cli/src/commands/*.ts` | One file per command group: `auth`, `emails`, `receive`, `agents`. |
| `cli/src/index.ts` | commander program wiring all commands. |
| `cli/test/*.test.ts` | Unit tests for config + client + receive cleanup. |
| `cli/Dockerfile` | Build CLI into a small Node image. |
| `.github/workflows/cli-image.yml` | Build + push `ghcr.io/lordbagel42/agent-email`. |

---

## Task 0: Project tooling & dependencies

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `test/tsconfig.json` (if needed for test types)

- [ ] **Step 1: Add dev deps for Workers testing**

Run:
```bash
pnpm add -D vitest @cloudflare/vitest-pool-workers @types/node
```
Expected: packages added, lockfile updated.

- [ ] **Step 2: Add test + lint scripts to `package.json`**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck": "tsc --noEmit"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Apply both migrations to the test D1 before tests run.
          d1Databases: ["DB"],
        },
      },
    },
  },
});
```

- [ ] **Step 4: Verify the toolchain runs (no tests yet)**

Run: `pnpm test`
Expected: Vitest starts and reports "no test files found" (exit 0 or 1 with that message). This confirms the pool-workers config loads.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore: add vitest + workers test pool"
```

---

## Task 1: `email-service.ts` — schema + module (TDD)

This is the core. We also finalize the app schema here (the `e-<tag>` format does not change the table shape, but we add a `body_html`/`message_id` already present and keep columns).

**Files:**
- Create: `src/email-service.ts`
- Create: `test/email-service.test.ts`
- Reference: `schema.sql` (existing `temp_emails`, `received_emails`)

- [ ] **Step 1: Write failing tests for create + list + ownership**

`test/email-service.test.ts`:
```ts
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import {
  createTempEmail, listTempEmails, deleteTempEmail,
  listMessages, readMessage, storeInbound, purgeExpired,
} from "../src/email-service";

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
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/email-service.test.ts`
Expected: FAIL — cannot find module `../src/email-service`.

- [ ] **Step 3: Implement `email-service.ts`**

```ts
const DOMAIN = "agent.raygen.dev";
const TAG_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomTag(len = 12): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += TAG_CHARS[b % TAG_CHARS.length];
  return out;
}

export interface TempEmail { address: string; created_at: string; expires_at: string; }
export interface MessageSummary { id: number; sender: string; subject: string; received_at: string; }
export interface MessageFull extends MessageSummary { recipient: string; body_text: string | null; body_html: string | null; }

export async function createTempEmail(
  env: CloudflareBindings, userId: string,
  opts: { prefix?: string; ttlMinutes?: number },
): Promise<{ address: string; expiresAt: string }> {
  const ttl = Math.min(Math.max(opts.ttlMinutes ?? 60, 1), 1440);
  const tag = opts.prefix ? `${opts.prefix}-${randomTag()}` : randomTag();
  // Cloudflare Email Routing constraint: single-char local prefix + hyphen.
  const address = `e-${tag}@${DOMAIN}`;
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO temp_emails (address, user_id, created_at, expires_at)
     VALUES (?, ?, datetime('now'), ?)`,
  ).bind(address, userId, expiresAt).run();
  return { address, expiresAt };
}

export async function listTempEmails(env: CloudflareBindings, userId: string): Promise<TempEmail[]> {
  const { results } = await env.DB.prepare(
    `SELECT address, created_at, expires_at FROM temp_emails
     WHERE user_id = ? AND expires_at > datetime('now') ORDER BY created_at DESC`,
  ).bind(userId).all<TempEmail>();
  return results;
}

async function ownsAddress(env: CloudflareBindings, userId: string, address: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM temp_emails WHERE address = ? AND user_id = ? AND expires_at > datetime('now')`,
  ).bind(address, userId).first();
  return !!row;
}

export async function deleteTempEmail(env: CloudflareBindings, userId: string, address: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `DELETE FROM temp_emails WHERE address = ? AND user_id = ?`,
  ).bind(address, userId).run();
  if (!res.meta.changes) return false;
  await env.DB.prepare(`DELETE FROM received_emails WHERE recipient = ?`).bind(address).run();
  return true;
}

export async function listMessages(env: CloudflareBindings, userId: string, address: string): Promise<MessageSummary[] | null> {
  if (!(await ownsAddress(env, userId, address))) return null;
  const { results } = await env.DB.prepare(
    `SELECT id, sender, subject, received_at FROM received_emails
     WHERE recipient = ? ORDER BY received_at DESC LIMIT 100`,
  ).bind(address).all<MessageSummary>();
  return results;
}

export async function readMessage(env: CloudflareBindings, userId: string, id: number): Promise<MessageFull | null> {
  const row = await env.DB.prepare(
    `SELECT re.id, re.recipient, re.sender, re.subject, re.body_text, re.body_html, re.received_at
     FROM received_emails re JOIN temp_emails te ON re.recipient = te.address
     WHERE re.id = ? AND te.user_id = ?`,
  ).bind(id, userId).first<MessageFull>();
  return row ?? null;
}

export async function storeInbound(
  env: CloudflareBindings,
  msg: { recipient: string; sender: string; subject: string; text: string | null; html: string | null; messageId: string | null },
): Promise<"stored" | "rejected"> {
  const active = await env.DB.prepare(
    `SELECT 1 FROM temp_emails WHERE address = ? AND expires_at > datetime('now')`,
  ).bind(msg.recipient).first();
  if (!active) return "rejected";
  await env.DB.prepare(
    `INSERT INTO received_emails (recipient, sender, subject, body_text, body_html, message_id, received_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).bind(msg.recipient, msg.sender, msg.subject, msg.text, msg.html, msg.messageId).run();
  return "stored";
}

export async function purgeExpired(env: CloudflareBindings): Promise<number> {
  await env.DB.prepare(
    `DELETE FROM received_emails WHERE recipient IN
       (SELECT address FROM temp_emails WHERE expires_at <= datetime('now'))`,
  ).run();
  const res = await env.DB.prepare(`DELETE FROM temp_emails WHERE expires_at <= datetime('now')`).run();
  return res.meta.changes ?? 0;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/email-service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add tests for messages, inbound, purge**

Append to `test/email-service.test.ts`:
```ts
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
```

- [ ] **Step 6: Run all email-service tests**

Run: `pnpm vitest run test/email-service.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/email-service.ts test/email-service.test.ts
git commit -m "feat: email-service as single source of truth (TDD)"
```

---

## Task 2: Agent-auth + device-authorization DB migration

The plugins need their own tables. We generate them from a Node-loadable schema config so the DDL matches the plugins exactly, then apply to local + remote D1.

**Files:**
- Create: `scripts/auth-schema.ts`
- Create: `migrations/0002_agent_auth.sql`
- Modify: `wrangler.jsonc` (add `migrations_dir` if not already implied)

- [ ] **Step 1: Install schema-generation tooling**

Run:
```bash
pnpm add -D @better-auth/cli better-sqlite3 @types/better-sqlite3 tsx kysely
```
Expected: installed.

- [ ] **Step 2: Create a Node-loadable auth config for generation only**

`scripts/auth-schema.ts` — same plugin list as the real `auth.ts`, but with a local SQLite dialect so the CLI can introspect it:
```ts
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { deviceAuthorization } from "better-auth/plugins";
import { agentAuth } from "@better-auth/agent-auth";
import { capabilities } from "../src/capabilities";

// Generation-only instance: real DB is D1 at runtime. Plugins must MATCH src/auth.ts.
export const auth = betterAuth({
  database: new Database(":memory:"),
  secret: "generation-only-secret-not-used-at-runtime",
  emailAndPassword: { enabled: true },
  plugins: [
    deviceAuthorization(),
    bearer(),
    agentAuth({
      providerName: "Agent Email",
      providerDescription: "Disposable @agent.raygen.dev inboxes for AI agents.",
      capabilities,
      approvalMethods: ["device_authorization"],
      deviceAuthorizationPage: "/agent-approval",
    }),
  ],
});
```

> NOTE: This imports `capabilities` from Task 3. Do Task 3's Step for `capabilities.ts` first if generating before auth.ts exists, or stub `export const capabilities = []` temporarily and regenerate after Task 3. Capabilities do not affect the generated SQL (they are runtime-only), so an empty array is fine for generation.

- [ ] **Step 3: Generate the SQL**

Run:
```bash
pnpm dlx @better-auth/cli generate --config scripts/auth-schema.ts --output migrations/0002_agent_auth.sql -y
```
Expected: a SQL file containing `CREATE TABLE` for `agent`, `agentHost`, `agentCapabilityGrant`, `approvalRequest`, plus the device-authorization `deviceCode` table (names per plugin). 

- [ ] **Step 4: Sanity-check the generated SQL**

Run: `grep -iE 'create table' migrations/0002_agent_auth.sql`
Expected: lines for the agent-auth tables and the device-code table. If the CLI emitted `ALTER TABLE` against better-auth core tables, keep those too. If any table from Task 1 (`temp_emails`) appears, remove it (already in 001/schema.sql).

- [ ] **Step 5: Apply to local test D1 and re-run email-service tests**

Run:
```bash
npx wrangler d1 execute agent-email-db --local --file=migrations/001_better_auth.sql
npx wrangler d1 execute agent-email-db --local --file=schema.sql
npx wrangler d1 execute agent-email-db --local --file=migrations/0002_agent_auth.sql
pnpm vitest run test/email-service.test.ts
```
Expected: migrations apply without error; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/auth-schema.ts migrations/0002_agent_auth.sql package.json pnpm-lock.yaml
git commit -m "feat: generate agent-auth + device-auth schema migration"
```

---

## Task 3: `capabilities.ts` — definitions + onExecute dispatcher

**Files:**
- Create: `src/capabilities.ts`
- Create: `test/capabilities.test.ts`

- [ ] **Step 1: Write failing test for the dispatcher**

`test/capabilities.test.ts`:
```ts
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { makeOnExecute } from "../src/capabilities";
import { listTempEmails } from "../src/email-service";

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
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/capabilities.test.ts`
Expected: FAIL — cannot find `../src/capabilities`.

- [ ] **Step 3: Implement `capabilities.ts`**

```ts
import type { Capability } from "@better-auth/agent-auth";
import {
  createTempEmail, listTempEmails, deleteTempEmail, listMessages, readMessage,
} from "./email-service";

export const capabilities: Capability[] = [
  {
    name: "create_temp_email",
    description: "Create a temporary e-<tag>@agent.raygen.dev address. Returns the address and its expiry.",
    input: {
      type: "object",
      properties: {
        prefix: { type: "string", description: "Optional label, e.g. 'signup'." },
        ttl_minutes: { type: "number", description: "Lifetime in minutes (1-1440, default 60)." },
      },
    },
  },
  { name: "list_temp_emails", description: "List your active temporary addresses." },
  {
    name: "list_emails",
    description: "List emails received at one of your temporary addresses.",
    input: { type: "object", properties: { address: { type: "string" } }, required: ["address"] },
  },
  {
    name: "read_email",
    description: "Read a received email by numeric id.",
    input: { type: "object", properties: { email_id: { type: "number" } }, required: ["email_id"] },
  },
  {
    name: "delete_temp_email",
    description: "Delete a temporary address and all of its received email.",
    input: { type: "object", properties: { address: { type: "string" } }, required: ["address"] },
  },
];

type ExecCtx = { capability: string; arguments?: Record<string, unknown>; agentSession: { user?: { id?: string } | null; userId?: string | null } };

export function makeOnExecute(env: CloudflareBindings) {
  return async function onExecute(ctx: ExecCtx): Promise<unknown> {
    const userId = ctx.agentSession.user?.id ?? ctx.agentSession.userId ?? null;
    if (!userId) throw new Error("Agent has no resolved user; approval required.");
    const args = ctx.arguments ?? {};
    switch (ctx.capability) {
      case "create_temp_email":
        return createTempEmail(env, userId, {
          prefix: args.prefix as string | undefined,
          ttlMinutes: args.ttl_minutes as number | undefined,
        });
      case "list_temp_emails":
        return { addresses: await listTempEmails(env, userId) };
      case "list_emails": {
        const msgs = await listMessages(env, userId, String(args.address));
        if (msgs === null) throw new Error("Address not found, not yours, or expired.");
        return { messages: msgs };
      }
      case "read_email": {
        const m = await readMessage(env, userId, Number(args.email_id));
        if (!m) throw new Error("Email not found or not accessible.");
        return m;
      }
      case "delete_temp_email": {
        const ok = await deleteTempEmail(env, userId, String(args.address));
        if (!ok) throw new Error("Address not found or not yours.");
        return { deleted: true };
      }
      default:
        throw new Error(`Unsupported capability: ${ctx.capability}`);
    }
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/capabilities.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/capabilities.ts test/capabilities.test.ts
git commit -m "feat: agent capabilities + onExecute dispatcher (TDD)"
```

---

## Task 4: `auth.ts` — wire the plugins

**Files:**
- Modify: `src/auth.ts`

- [ ] **Step 1: Rewrite `src/auth.ts`**

```ts
import { betterAuth } from "better-auth";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { agentAuth } from "@better-auth/agent-auth";
import { capabilities, makeOnExecute } from "./capabilities";

export function createAuth(env: CloudflareBindings) {
  return betterAuth({
    database: env.DB,
    baseURL: env.AUTH_URL,
    secret: (env as unknown as Record<string, string>).AUTH_SECRET,
    emailAndPassword: { enabled: true },
    trustedOrigins: [env.AUTH_URL],
    plugins: [
      deviceAuthorization(),
      bearer(),
      agentAuth({
        providerName: "Agent Email",
        providerDescription: "Disposable @agent.raygen.dev inboxes for AI agents.",
        modes: ["delegated", "autonomous"],
        capabilities,
        approvalMethods: ["device_authorization"],
        deviceAuthorizationPage: "/agent-approval",
        onExecute: makeOnExecute(env),
        onEvent: (event) => { console.log("agent-auth", JSON.stringify(event)); },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors in `src/auth.ts` (capabilities/onExecute types line up). If `agentAuth` option names differ from the installed types, fix per `node_modules/@better-auth/agent-auth/dist/types-DNZbytck.d.ts` (`AgentAuthOptions`).

- [ ] **Step 3: Commit**

```bash
git add src/auth.ts
git commit -m "feat: wire agentAuth + deviceAuthorization + bearer plugins"
```

---

## Task 5: `rest-api.ts` — CLI REST surface (TDD)

**Files:**
- Create: `src/rest-api.ts`
- Create: `test/rest-api.test.ts`

- [ ] **Step 1: Write failing tests (auth required + CRUD via a signed-up user)**

`test/rest-api.test.ts`:
```ts
import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM received_emails");
  await env.DB.exec("DELETE FROM temp_emails");
});

async function signUpAndToken(): Promise<string> {
  // Sign up via better-auth, then create a session token through the bearer flow.
  const email = `u${crypto.randomUUID().slice(0,8)}@example.com`;
  const res = await SELF.fetch("https://email.agent.raygen.dev/api/auth/sign-up/email", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password12345", name: "u" }),
  });
  expect(res.ok).toBe(true);
  // bearer plugin returns the session token in the set-auth-token header
  const token = res.headers.get("set-auth-token");
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
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/rest-api.test.ts`
Expected: FAIL (routes not mounted yet → likely 404, not 401).

- [ ] **Step 3: Implement `src/rest-api.ts`**

```ts
import { Hono } from "hono";
import { createAuth } from "./auth";
import {
  createTempEmail, listTempEmails, deleteTempEmail, listMessages, readMessage,
} from "./email-service";

type Vars = { userId: string };
export const restApi = new Hono<{ Bindings: CloudflareBindings; Variables: Vars }>();

restApi.use("*", async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user?.id) return c.json({ error: "unauthorized", message: "Sign in first." }, 401);
  c.set("userId", session.user.id);
  await next();
});

restApi.post("/emails", async (c) => {
  const body = await c.req.json<{ prefix?: string; ttl_minutes?: number }>().catch(() => ({}));
  const res = await createTempEmail(c.env, c.get("userId"), { prefix: body.prefix, ttlMinutes: body.ttl_minutes });
  return c.json(res, 201);
});

restApi.get("/emails", async (c) =>
  c.json({ addresses: await listTempEmails(c.env, c.get("userId")) }));

restApi.delete("/emails/:address", async (c) => {
  const ok = await deleteTempEmail(c.env, c.get("userId"), c.req.param("address"));
  return ok ? c.json({ deleted: true }) : c.json({ error: "not_found", message: "Address not found or not yours." }, 404);
});

restApi.get("/emails/:address/messages", async (c) => {
  const msgs = await listMessages(c.env, c.get("userId"), c.req.param("address"));
  return msgs === null
    ? c.json({ error: "not_found", message: "Address not found, not yours, or expired." }, 404)
    : c.json({ messages: msgs });
});

restApi.get("/messages/:id", async (c) => {
  const m = await readMessage(c.env, c.get("userId"), Number(c.req.param("id")));
  return m ? c.json(m) : c.json({ error: "not_found", message: "Email not found." }, 404);
});
```

- [ ] **Step 4: Mount it temporarily for the test (will be finalized in Task 7)**

In `src/index.ts`, add (near other routes):
```ts
import { restApi } from "./rest-api";
app.route("/api", restApi);
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run test/rest-api.test.ts`
Expected: PASS (2 tests). If `set-auth-token` is empty, switch the helper to read the session token from the `sign-in/email` response per the bearer plugin docs and adjust.

- [ ] **Step 6: Commit**

```bash
git add src/rest-api.ts test/rest-api.test.ts src/index.ts
git commit -m "feat: session-protected REST API for the CLI (TDD)"
```

---

## Task 6: `email-handler.ts` — route inbound through email-service

**Files:**
- Modify: `src/email-handler.ts`

- [ ] **Step 1: Rewrite `email-handler.ts`**

```ts
import PostalMime from "postal-mime";
import { storeInbound } from "./email-service";

export async function handleInboundEmail(
  message: ForwardableEmailMessage, env: CloudflareBindings,
): Promise<void> {
  const rawBuffer = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(rawBuffer);
  const result = await storeInbound(env, {
    recipient: message.to,
    sender: message.from,
    subject: parsed.subject || "(no subject)",
    text: parsed.text ?? null,
    html: parsed.html ?? null,
    messageId: message.headers.get("message-id"),
  });
  if (result === "rejected") message.setReject("Address not found or expired");
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/email-handler.ts
git commit -m "refactor: inbound handler uses email-service"
```

---

## Task 7: `index.ts` — routing, discovery, pages, cron

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Rewrite `src/index.ts`**

```ts
import { Hono } from "hono";
import { createAuth } from "./auth";
import { restApi } from "./rest-api";
import { handleInboundEmail } from "./email-handler";
import { purgeExpired } from "./email-service";

const app = new Hono<{ Bindings: CloudflareBindings }>();

// better-auth (login, device flow, agent-auth endpoints, its own .well-known/*)
app.all("/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// CLI REST API (session/bearer protected inside the router)
app.route("/api", restApi);

// Agent Auth discovery document at the app root (separate from /api/auth base path)
app.get("/.well-known/agent-configuration", async (c) => {
  const auth = createAuth(c.env);
  const config = await auth.api.getAgentConfiguration();
  return c.json(config);
});

// Minimal browser pages (served from ASSETS)
for (const path of ["/sign-in", "/device", "/agent-approval"]) {
  app.get(path, (c) => c.env.ASSETS.fetch(new Request(new URL(`${path}.html`, c.req.url))));
}

app.get("/", (c) => c.text("Agent Email — agent-auth provider. Discovery: /.well-known/agent-configuration"));
app.all("*", (c) => c.text("Not found", 404));

export default {
  fetch: app.fetch,
  async email(message: ForwardableEmailMessage, env: CloudflareBindings) {
    await handleInboundEmail(message, env);
  },
  async scheduled(_event: ScheduledController, env: CloudflareBindings) {
    const removed = await purgeExpired(env);
    console.log(`purgeExpired removed ${removed} expired address(es)`);
  },
} satisfies ExportedHandler<CloudflareBindings>;
```

- [ ] **Step 2: Verify the discovery endpoint name**

Run: `grep -n "getAgentConfiguration" node_modules/@better-auth/agent-auth/dist/index-BRF1tUaF.d.ts`
Expected: confirms `getAgentConfiguration` is on `auth.api`. If it is named differently, use that name.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all email-service, capabilities, rest-api tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: root routing, agent discovery, minimal pages, purge cron"
```

---

## Task 8: Minimal browser pages

**Files:**
- Create: `public/sign-in.html`
- Create: `public/device.html`
- Create: `public/agent-approval.html`
- Delete: `public/index.html` (replaced by sign-in)

- [ ] **Step 1: Create `public/sign-in.html`**

Reuse the existing dark form from the old `public/index.html` (email/password + signup toggle hitting `/api/auth/sign-up/email` and `/api/auth/sign-in/email`). Keep it self-contained (inline CSS/JS). Add a short note: "After signing in, return to your terminal."

- [ ] **Step 2: Create `public/device.html` (human CLI device approval)**

A page that reads `?user_code=` from the URL (prefill), requires the user to be signed in (link to `/sign-in` if the `device/approve` call returns 401), and POSTs to `/api/auth/device/approve` with `{ userCode }` (and a Deny button → `/api/auth/device/deny`). Show success/failure inline.

```html
<!-- key script logic -->
<script>
const code = new URLSearchParams(location.search).get("user_code") || "";
document.getElementById("code").value = code;
async function act(path) {
  const userCode = document.getElementById("code").value.trim();
  const r = await fetch(`/api/auth/device/${path}`, {
    method: "POST", headers: { "content-type": "application/json" },
    credentials: "include", body: JSON.stringify({ userCode }),
  });
  const el = document.getElementById("msg");
  if (r.status === 401) { el.textContent = "Please sign in first."; location.href = "/sign-in?next=" + encodeURIComponent(location.href); return; }
  el.textContent = r.ok ? "✓ Approved — return to your terminal." : "Failed: " + r.status;
}
</script>
```

- [ ] **Step 3: Create `public/agent-approval.html` (agent capability approval)**

The `deviceAuthorizationPage` for agentAuth. It reads the agent device/user code from the query string, shows the requesting agent + requested capabilities (fetch from the agent-auth pending endpoint), and approves via `/api/auth/agent/approve-capability` (confirm exact path + body against `node_modules/@better-auth/agent-auth/dist/index.js` route list: `/agent/approve-capability`). Include a Deny path. Require sign-in (redirect to `/sign-in` on 401).

> Implementer: confirm the approval request/response shape by reading the `approve-capability` and `request-capability` handlers in `node_modules/@better-auth/agent-auth/dist/index.js`, and the pending-list endpoint, before finalizing the fetch calls.

- [ ] **Step 4: Delete the old index page**

Run: `git rm public/index.html`

- [ ] **Step 5: Manual verification in dev**

Run: `pnpm run dev` then in another shell:
```bash
curl -s localhost:8787/ | head -1
curl -s localhost:8787/sign-in | grep -i "<title>"
curl -s localhost:8787/.well-known/agent-configuration | head -c 200
```
Expected: root plain text; sign-in HTML title; discovery returns JSON with `issuer`/`endpoints`. Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add public/ && git commit -m "feat: minimal sign-in, device, and agent-approval pages"
```

---

## Task 9: `wrangler.jsonc` — cron trigger

**Files:**
- Modify: `wrangler.jsonc`

- [ ] **Step 1: Add the cron trigger**

Add to `wrangler.jsonc`:
```jsonc
"triggers": { "crons": ["*/15 * * * *"] }
```

- [ ] **Step 2: Validate config**

Run: `npx wrangler deploy --dry-run`
Expected: dry run succeeds, lists the cron trigger and D1 binding.

- [ ] **Step 3: Commit**

```bash
git add wrangler.jsonc && git commit -m "chore: 15-min purge cron trigger"
```

---

## Task 10: CLI scaffold — config + client (TDD)

**Files:**
- Create: `cli/package.json`
- Create: `cli/tsconfig.json`
- Create: `cli/src/config.ts`
- Create: `cli/src/client.ts`
- Create: `cli/test/config.test.ts`
- Create: `cli/test/client.test.ts`

- [ ] **Step 1: Create `cli/package.json`**

```json
{
  "name": "@lordbagel42/agent-email-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "agent-email": "dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": { "commander": "^12.1.0" },
  "devDependencies": { "typescript": "^6.0.3", "vitest": "^2.0.0", "@types/node": "^26.0.1" }
}
```

- [ ] **Step 2: Create `cli/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ES2022", "moduleResolution": "bundler",
    "outDir": "dist", "rootDir": "src", "strict": true, "esModuleInterop": true,
    "skipLibCheck": true, "declaration": false
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install CLI deps**

Run: `cd cli && pnpm install && cd ..`
Expected: installs commander + dev deps.

- [ ] **Step 4: Write failing test for config resolution**

`cli/test/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveConfig } from "../src/config";

describe("resolveConfig precedence", () => {
  it("prefers explicit token over env", () => {
    const c = resolveConfig({ token: "explicit" }, { AGENT_EMAIL_TOKEN: "envtok", AGENT_EMAIL_URL: "https://x" });
    expect(c.token).toBe("explicit");
    expect(c.baseUrl).toBe("https://x");
  });
  it("falls back to env token and default url", () => {
    const c = resolveConfig({}, { AGENT_EMAIL_TOKEN: "envtok" });
    expect(c.token).toBe("envtok");
    expect(c.baseUrl).toBe("https://email.agent.raygen.dev");
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `cd cli && pnpm vitest run test/config.test.ts; cd ..`
Expected: FAIL — no `../src/config`.

- [ ] **Step 6: Implement `cli/src/config.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const DEFAULT_URL = "https://email.agent.raygen.dev";
export interface StoredConfig { baseUrl: string; token?: string; user?: { id: string; email: string }; }
export interface ResolvedConfig { baseUrl: string; token?: string; user?: StoredConfig["user"]; }

export function defaultConfigPath(): string {
  return process.env.AGENT_EMAIL_CONFIG || join(homedir(), ".config", "agent-email", "config.json");
}

export function readStored(path = defaultConfigPath()): StoredConfig {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return { baseUrl: DEFAULT_URL }; }
}

export function writeStored(cfg: StoredConfig, path = defaultConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function clearStored(path = defaultConfigPath()): void {
  if (existsSync(path)) rmSync(path);
}

export function resolveConfig(
  flags: { token?: string; baseUrl?: string; configPath?: string },
  envv: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  const stored = readStored(flags.configPath ?? defaultConfigPath());
  return {
    baseUrl: flags.baseUrl || envv.AGENT_EMAIL_URL || stored.baseUrl || DEFAULT_URL,
    token: flags.token || envv.AGENT_EMAIL_TOKEN || stored.token,
    user: stored.user,
  };
}
```

- [ ] **Step 7: Run config test → pass**

Run: `cd cli && pnpm vitest run test/config.test.ts; cd ..`
Expected: PASS (2 tests).

- [ ] **Step 8: Write failing test + implement `cli/src/client.ts`**

`cli/test/client.test.ts`:
```ts
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
```

`cli/src/client.ts`:
```ts
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface ClientOpts { baseUrl: string; token?: string; }

export class ApiClient {
  constructor(private opts: ClientOpts, private fetchImpl: typeof fetch = fetch) {}
  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.fetchImpl(this.opts.baseUrl + path, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, data?.message || data?.error || `HTTP ${res.status}`);
    return data as T;
  }
  get<T>(p: string) { return this.req<T>("GET", p); }
  post<T>(p: string, b?: unknown) { return this.req<T>("POST", p, b); }
  del<T>(p: string) { return this.req<T>("DELETE", p); }
}
```

- [ ] **Step 9: Run client test → pass**

Run: `cd cli && pnpm vitest run test/client.test.ts; cd ..`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add cli/ && git commit -m "feat: CLI scaffold — config + http client (TDD)"
```

---

## Task 11: CLI auth commands (signup, login, logout, whoami)

**Files:**
- Create: `cli/src/commands/auth.ts`
- Create: `cli/src/device.ts`
- Create: `cli/test/device.test.ts`

- [ ] **Step 1: Write failing test for device-poll backoff/expiry**

`cli/test/device.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd cli && pnpm vitest run test/device.test.ts; cd ..`
Expected: FAIL — no `../src/device`.

- [ ] **Step 3: Implement `cli/src/device.ts`**

```ts
const CLIENT_ID = "agent-email-cli";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface DeviceCodeResponse {
  device_code: string; user_code: string;
  verification_uri: string; verification_uri_complete?: string;
  interval: number; expires_in: number;
}

export async function requestDeviceCode(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<DeviceCodeResponse> {
  const res = await fetchImpl(`${baseUrl}/api/auth/device/code`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!res.ok) throw new Error(`device/code failed: ${res.status}`);
  return res.json();
}

export async function pollDeviceToken(
  baseUrl: string, deviceCode: string, clientId = CLIENT_ID,
  intervalSec = 5, fetchImpl: typeof fetch = fetch, sleepImpl = sleep,
): Promise<string> {
  let interval = Math.max(intervalSec, 1);
  for (;;) {
    const res = await fetchImpl(`${baseUrl}/api/auth/device/token`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: deviceCode, client_id: clientId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.access_token) return data.access_token as string;
    switch (data.error) {
      case "authorization_pending": break;
      case "slow_down": interval += 5; break;
      case "expired_token": throw new Error("Device code expired. Run `agent-email login` again.");
      case "access_denied": throw new Error("Approval was denied.");
      default: throw new Error(data.error_description || data.error || `device/token failed: ${res.status}`);
    }
    await sleepImpl(interval * 1000);
  }
}
```

- [ ] **Step 4: Run device test → pass**

Run: `cd cli && pnpm vitest run test/device.test.ts; cd ..`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement `cli/src/commands/auth.ts`**

```ts
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ApiClient } from "../client.js";
import { readStored, writeStored, clearStored, type ResolvedConfig } from "../config.js";
import { requestDeviceCode, pollDeviceToken } from "../device.js";

async function prompt(q: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  const ans = await rl.question(q); rl.close(); return ans.trim();
}

export async function doLogin(cfg: ResolvedConfig): Promise<void> {
  const dc = await requestDeviceCode(cfg.baseUrl);
  console.log(`\n  Open: ${dc.verification_uri_complete || dc.verification_uri}`);
  console.log(`  Code: ${dc.user_code}\n  Waiting for approval...`);
  const token = await pollDeviceToken(cfg.baseUrl, dc.device_code, "agent-email-cli", dc.interval);
  const client = new ApiClient({ baseUrl: cfg.baseUrl, token });
  const me = await client.get<{ user: { id: string; email: string } }>("/api/auth/get-session").catch(() => null);
  const stored = readStored();
  writeStored({ ...stored, baseUrl: cfg.baseUrl, token, user: me?.user });
  console.log(`✓ Logged in${me?.user ? ` as ${me.user.email}` : ""}.`);
}

export async function doSignup(cfg: ResolvedConfig): Promise<void> {
  const email = await prompt("Email: ");
  const password = await prompt("Password: ");
  const res = await fetch(`${cfg.baseUrl}/api/auth/sign-up/email`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: email.split("@")[0] }),
  });
  if (!res.ok) throw new Error(`Signup failed: ${(await res.json().catch(() => ({}))).message || res.status}`);
  console.log("✓ Account created. Logging in...");
  await doLogin(cfg);
}

export async function doLogout(cfg: ResolvedConfig): Promise<void> {
  if (cfg.token) await fetch(`${cfg.baseUrl}/api/auth/sign-out`, { method: "POST", headers: { authorization: `Bearer ${cfg.token}` } }).catch(() => {});
  clearStored();
  console.log("✓ Logged out.");
}

export async function doWhoami(cfg: ResolvedConfig): Promise<void> {
  if (!cfg.token) { console.log("Not logged in. Run `agent-email login`."); return; }
  const client = new ApiClient({ baseUrl: cfg.baseUrl, token: cfg.token });
  const me = await client.get<{ user?: { email: string } }>("/api/auth/get-session").catch(() => null);
  console.log(me?.user ? `Logged in as ${me.user.email}` : "Session invalid. Run `agent-email login`.");
}
```

> Implementer: confirm the get-session path/shape (`/api/auth/get-session`) for the installed better-auth; adjust if it differs. The bearer plugin must accept the device-issued token for these calls.

- [ ] **Step 6: Commit**

```bash
git add cli/ && git commit -m "feat: CLI auth commands + device poll (TDD)"
```

---

## Task 12: CLI email commands (new, ls, rm, inbox, read, receive)

**Files:**
- Create: `cli/src/commands/emails.ts`
- Create: `cli/src/commands/receive.ts`
- Create: `cli/test/receive.test.ts`

- [ ] **Step 1: Write failing test for `receive` cleanup guarantee**

`cli/test/receive.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd cli && pnpm vitest run test/receive.test.ts; cd ..`
Expected: FAIL — no `../src/commands/receive`.

- [ ] **Step 3: Implement `cli/src/commands/receive.ts`**

```ts
import type { ApiClient } from "../client.js";

interface ReceiveOpts { prefix?: string; ttlMinutes?: number; pollMs?: number; timeoutMs?: number; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = (a: string) => encodeURIComponent(a);

export async function runReceive(client: ApiClient, opts: ReceiveOpts): Promise<void> {
  const pollMs = opts.pollMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const created = await client.post<{ address: string }>("/api/emails", { prefix: opts.prefix, ttl_minutes: opts.ttlMinutes });
  const address = created.address;
  console.log(`Watching ${address} (Ctrl-C to stop)...`);

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return; cleaned = true;
    await client.del(`/api/emails/${enc(address)}`).catch(() => {});
    console.log(`Deleted ${address}.`);
  };
  const onSig = () => { cleanup().finally(() => process.exit(0)); };
  process.on("SIGINT", onSig); process.on("SIGTERM", onSig);

  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { messages } = await client.get<{ messages: { id: number; sender: string; subject: string }[] }>(`/api/emails/${enc(address)}/messages`);
      if (messages.length) {
        const m = messages[0];
        const full = await client.get<{ subject: string; sender: string; body_text?: string; body_html?: string }>(`/api/messages/${m.id}`);
        console.log(`\nFrom: ${full.sender}\nSubject: ${full.subject}\n\n${full.body_text || full.body_html || "(empty)"}\n`);
        return;
      }
      await sleep(pollMs);
    }
    console.log("Timed out waiting for email.");
  } finally {
    process.off("SIGINT", onSig); process.off("SIGTERM", onSig);
    await cleanup();
  }
}
```

- [ ] **Step 4: Run receive test → pass**

Run: `cd cli && pnpm vitest run test/receive.test.ts; cd ..`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement `cli/src/commands/emails.ts`**

```ts
import type { ApiClient } from "../client.js";
const enc = (a: string) => encodeURIComponent(a);

export async function listEmails(c: ApiClient) {
  const { addresses } = await c.get<{ addresses: { address: string; expires_at: string }[] }>("/api/emails");
  if (!addresses.length) return console.log("No active addresses.");
  for (const a of addresses) console.log(`${a.address}  (expires ${a.expires_at})`);
}
export async function newEmail(c: ApiClient, opts: { prefix?: string; ttl?: number }) {
  const r = await c.post<{ address: string; expiresAt: string }>("/api/emails", { prefix: opts.prefix, ttl_minutes: opts.ttl });
  console.log(`${r.address}\nExpires: ${r.expiresAt}`);
}
export async function rmEmail(c: ApiClient, address: string) {
  await c.del(`/api/emails/${enc(address)}`); console.log(`Deleted ${address}.`);
}
export async function inbox(c: ApiClient, address: string, watch: boolean) {
  const show = async () => {
    const { messages } = await c.get<{ messages: { id: number; sender: string; subject: string; received_at: string }[] }>(`/api/emails/${enc(address)}/messages`);
    console.clear?.();
    if (!messages.length) console.log("No messages yet.");
    else for (const m of messages) console.log(`[${m.id}] ${m.sender} — ${m.subject} (${m.received_at})`);
  };
  await show();
  if (!watch) return;
  for (;;) { await new Promise((r) => setTimeout(r, 3000)); await show(); }
}
export async function readEmail(c: ApiClient, id: string) {
  const m = await c.get<{ sender: string; recipient: string; subject: string; received_at: string; body_text?: string; body_html?: string }>(`/api/messages/${id}`);
  console.log(`From: ${m.sender}\nTo: ${m.recipient}\nSubject: ${m.subject}\nDate: ${m.received_at}\n\n${m.body_text || m.body_html || "(empty)"}`);
}
```

- [ ] **Step 6: Commit**

```bash
git add cli/ && git commit -m "feat: CLI email + receive commands (TDD)"
```

---

## Task 13: CLI agents commands + program wiring

**Files:**
- Create: `cli/src/commands/agents.ts`
- Create: `cli/src/index.ts`

- [ ] **Step 1: Implement `cli/src/commands/agents.ts`**

```ts
import type { ApiClient } from "../client.js";

export async function listAgents(c: ApiClient) {
  // agent-auth exposes session-protected /agent/list
  const res = await c.get<{ agents?: { id: string; name?: string; status: string }[] }>("/api/auth/agent/list");
  const agents = res.agents ?? [];
  if (!agents.length) return console.log("No connected agents.");
  for (const a of agents) console.log(`${a.id}  ${a.name ?? ""}  [${a.status}]`);
}
export async function revokeAgent(c: ApiClient, id: string) {
  await c.post("/api/auth/agent/revoke", { agentId: id });
  console.log(`Revoked agent ${id}.`);
}
```

> Implementer: confirm `/agent/list` + `/agent/revoke` request/response shapes against `node_modules/@better-auth/agent-auth/dist/index.js` and adjust field names (`agentId` vs `id`).

- [ ] **Step 2: Implement `cli/src/index.ts` (commander wiring)**

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { resolveConfig } from "./config.js";
import { ApiClient, ApiError } from "./client.js";
import { doLogin, doSignup, doLogout, doWhoami } from "./commands/auth.js";
import { listEmails, newEmail, rmEmail, inbox, readEmail } from "./commands/emails.js";
import { runReceive } from "./commands/receive.js";
import { listAgents, revokeAgent } from "./commands/agents.js";

const program = new Command();
program.name("agent-email").description("Disposable agent email — CLI").version("0.1.0")
  .option("--token <token>", "bearer token (overrides env/config)")
  .option("--url <baseUrl>", "service base URL")
  .option("--config <path>", "config file path");

function cfg() {
  const o = program.opts();
  return resolveConfig({ token: o.token, baseUrl: o.url, configPath: o.config });
}
function authed(): ApiClient {
  const c = cfg();
  if (!c.token) { console.error("Not logged in. Run `agent-email login`."); process.exit(2); }
  return new ApiClient({ baseUrl: c.baseUrl, token: c.token });
}

program.command("signup").action(() => doSignup(cfg()));
program.command("login").action(() => doLogin(cfg()));
program.command("logout").action(() => doLogout(cfg()));
program.command("whoami").action(() => doWhoami(cfg()));

program.command("new").option("-p, --prefix <p>").option("-t, --ttl <m>", "minutes", (v) => parseInt(v, 10))
  .action((o) => newEmail(authed(), o));
program.command("ls").action(() => listEmails(authed()));
program.command("rm <address>").action((a) => rmEmail(authed(), a));
program.command("inbox <address>").option("-w, --watch").action((a, o) => inbox(authed(), a, !!o.watch));
program.command("read <id>").action((id) => readEmail(authed(), id));
program.command("receive").option("-p, --prefix <p>").option("-t, --ttl <m>", "minutes", (v) => parseInt(v, 10))
  .option("--timeout <s>", "seconds", (v) => parseInt(v, 10))
  .action((o) => runReceive(authed(), { prefix: o.prefix, ttlMinutes: o.ttl, timeoutMs: o.timeout ? o.timeout * 1000 : undefined }));

const agents = program.command("agents");
agents.command("ls").action(() => listAgents(authed()));
agents.command("revoke <id>").action((id) => revokeAgent(authed(), id));

program.parseAsync().catch((e) => {
  if (e instanceof ApiError && e.status === 401) console.error("Session expired. Run `agent-email login`.");
  else console.error(e.message || String(e));
  process.exit(1);
});
```

- [ ] **Step 3: Build the CLI**

Run: `cd cli && pnpm build && node dist/index.js --help; cd ..`
Expected: commander prints help listing all commands.

- [ ] **Step 4: Run full CLI test suite**

Run: `cd cli && pnpm test; cd ..`
Expected: all CLI tests PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/ && git commit -m "feat: CLI agents commands + program wiring"
```

---

## Task 14: Dockerfile + GHCR workflow

**Files:**
- Create: `cli/Dockerfile`
- Create: `cli/.dockerignore`
- Create: `.github/workflows/cli-image.yml`

- [ ] **Step 1: Create `cli/Dockerfile`**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
ENTRYPOINT ["node", "dist/index.js"]
```

- [ ] **Step 2: Create `cli/.dockerignore`**

```
node_modules
dist
test
```

- [ ] **Step 3: Create `.github/workflows/cli-image.yml`**

```yaml
name: CLI image
on:
  push:
    tags: ["v*"]
    branches: ["main"]
    paths: ["cli/**", ".github/workflows/cli-image.yml"]
  workflow_dispatch:
permissions:
  contents: read
  packages: write
jobs:
  build-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/lordbagel42/agent-email
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=raw,value=latest,enable={{is_default_branch}}
      - uses: docker/build-push-action@v6
        with:
          context: ./cli
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

- [ ] **Step 4: Build the image locally to verify the Dockerfile**

Run: `docker build -t agent-email-cli:test ./cli && docker run --rm agent-email-cli:test --help`
Expected: help output prints. (If Docker is unavailable in the environment, skip the run and note it.)

- [ ] **Step 5: Commit**

```bash
git add cli/Dockerfile cli/.dockerignore .github/workflows/cli-image.yml
git commit -m "ci: build + push agent-email CLI image to GHCR"
```

---

## Task 15: Deploy + end-to-end verification

**Files:** none (operational). Update README last.

- [ ] **Step 1: Ensure secret + remote schema**

Run:
```bash
npx wrangler secret put AUTH_SECRET   # paste: openssl rand -base64 32
npx wrangler d1 execute agent-email-db --remote --file=migrations/0002_agent_auth.sql
```
Expected: secret stored; migration applies (core + schema.sql already applied previously per README — apply them too if the remote DB is fresh).

- [ ] **Step 2: Deploy**

Run: `pnpm run deploy`
Expected: deploy succeeds; prints the worker URL + cron trigger.

- [ ] **Step 3: Verify discovery + unauth REST**

Run:
```bash
curl -s https://email.agent.raygen.dev/.well-known/agent-configuration | head -c 300
curl -s -o /dev/null -w "%{http_code}\n" https://email.agent.raygen.dev/api/emails
```
Expected: discovery JSON with `issuer`/`endpoints`; REST returns `401`.

- [ ] **Step 4: CLI signup/login + email round-trip**

Run:
```bash
cd cli && pnpm build
node dist/index.js --url https://email.agent.raygen.dev signup   # complete device approval in browser
node dist/index.js new --prefix smoke --ttl 30
# send a real email to the printed address from any mail client, then:
node dist/index.js ls
node dist/index.js inbox <printed-address>
node dist/index.js read <id>
cd ..
```
Expected: address created; after sending mail, it appears in `inbox` and `read` shows the body. Capture output as evidence.

- [ ] **Step 5: Verify `receive` one-shot + auto-delete**

Run: `node cli/dist/index.js receive --prefix once --timeout 120`
Then send an email to the printed address.
Expected: message prints, address is auto-deleted (`ls` no longer shows it).

- [ ] **Step 6: Verify agent capability flow**

Using the agent-auth tooling (`@auth/agent-cli`) or a manual script: discover → register → request `list_temp_emails` → approve at `/agent-approval` in the browser → execute. Confirm results are scoped to your user.
Expected: capability executes; `agent-email agents ls` shows the agent; `agents revoke <id>` revokes it.

- [ ] **Step 7: Update `README.md`**

Rewrite the README for the new architecture: agent-auth (not MCP OAuth), capabilities table, CLI install via `docker run ghcr.io/lordbagel42/agent-email …` and local dev, the `e-<tag>@agent.raygen.dev` format, device-flow login, and the purge cron. Remove MCP-OAuth-specific instructions.

- [ ] **Step 8: Final commit**

```bash
git add README.md
git commit -m "docs: README for agent-auth + CLI"
```

---

## Self-Review notes (for the implementer)

- **Unstable plugin:** `@better-auth/agent-auth@0.6.2` API may differ slightly from this plan's assumed option/endpoint names. Where a step says "confirm against `node_modules/...`", do so before finalizing — especially `getAgentConfiguration`, `/agent/approve-capability`, `/agent/list`, `/agent/revoke`, and the device-approval page wiring.
- **Bearer token source:** Tasks 5/11 assume the device grant's `access_token` is accepted by `auth.api.getSession` via the bearer plugin. If the device token is an OAuth-style token rather than a session token, adjust the REST middleware to validate it accordingly (still via better-auth), keeping `email-service` untouched.
- **Schema generation (Task 2):** if `@better-auth/cli generate` cannot load the SQLite config, fall back to extracting each plugin's declared schema from `node_modules/@better-auth/agent-auth/dist/index.js` (`modelName` blocks) and `better-auth`'s device-authorization plugin, and hand-write the DDL to match — then verify by applying to a local D1 and running the suite.
- **Single source of truth:** never duplicate email logic into REST or capabilities — both must call `email-service`.
```
