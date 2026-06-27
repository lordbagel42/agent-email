# Agent Email — Agent Auth + CLI redesign

**Date:** 2026-06-27
**Status:** Approved (design), pending implementation plan

## Summary

`cf-email-mcp` is a Cloudflare Worker that gives AI agents disposable
`@agent.raygen.dev` email addresses and lets them read inbound mail. Today it
authenticates agents with better-auth's **MCP OAuth plugin** (now marked
"will soon be deprecated") via a hand-rolled, fragile token-verification path.

This redesign:

1. Replaces the deprecating MCP OAuth plugin with **`@better-auth/agent-auth`**
   (v0.6.2) — better-auth's purpose-built Agent Auth Protocol implementation —
   so agents get capability-scoped, user-approved, short-lived-JWT access.
2. Extracts all email business logic into one shared module so the agent
   interface, the human CLI, and the inbound-mail handler share a single source
   of truth.
3. Adds a first-class **human CLI** (`agent-email`) that logs in via the OAuth
   Device Authorization grant and manages addresses, inbox, and connected agents.
4. Strips the web surface to the minimal auth/approval pages only.

## Goals

- Use better-auth agent auth to its full potential: capabilities, approval
  flows, agent identity/registration, audit events.
- Single source of truth for email operations (no logic duplicated per surface).
- A robust, self-sufficient CLI (handles poll backoff, token expiry, cleanup).
- Deployed and smoke-tested end to end.

## Non-goals

- No marketing/dashboard website. Only the auth + agent-approval pages render.
- No MCP OAuth endpoint. The shipped agent-auth package (0.6.2) has **no MCP
  adapter** yet (the docs describe one that is not published). We adopt the
  Agent Auth Protocol directly; the user accepted this forward-looking bet.
- No API-key plugin. Agents use agent-auth JWTs; the human CLI uses a device
  session. Nothing needs a long-lived static key.

## Constraints (confirmed with user)

- **Email format must be `e-<tag>@agent.raygen.dev`** (hyphen, single-char
  local prefix) due to Cloudflare Email Routing's matching limitations. Not
  `e+<tag>` (plus) and not arbitrary local parts.
- Agent-auth is **v0.6.x, "may change."** Pin the version exactly; expect
  possible follow-up tweaks on upgrade.
- CLI human auth = **OAuth 2.0 Device Authorization grant**.

## Architecture

```
                         ┌─────────────────────────┐
   AI agents  ──proto──▶ │ @better-auth/agent-auth  │
   (Agent Auth Protocol) │  capabilities + onExecute│──┐
                         └─────────────────────────┘  │
                                                       ▼
   Human (CLI) ─device──▶ better-auth session ──▶ REST API ──▶ ┌───────────────┐
                          (device-authorization      (Hono,    │ email-service │
                           + bearer plugins)          bearer)  │  (one source  │
                                                               │   of truth)   │
   Inbound mail ────────────────────────────────▶ email() ───▶└──────┬────────┘
   (Cloudflare Email Routing)                       handler           │
                                                                      ▼
                                                                  D1 (DB)
```

### File layout (`src/`)

| File | Responsibility |
|------|----------------|
| `auth.ts` | `betterAuth({...})` with `emailAndPassword`, `agentAuth`, `deviceAuthorization`, `bearer`. Defines capabilities + `onExecute`. |
| `email-service.ts` | **Single source of truth.** Pure functions over D1: `createTempEmail`, `listTempEmails`, `deleteTempEmail`, `listMessages`, `readMessage`, `storeInbound`, `purgeExpired`. All scoped by `userId` where applicable. No transport concerns. |
| `capabilities.ts` | Capability definitions (name/description/input Zod-or-JSON-schema) + the `onExecute` switch that maps each capability to `email-service`, using `agentSession.user.id`. |
| `rest-api.ts` | Hono sub-router for the CLI. Session/bearer protected. Thin wrappers over `email-service`. |
| `email-handler.ts` | Inbound mail → `email-service.storeInbound` (reject unknown/expired). |
| `index.ts` | Hono root: mounts `/api/auth/*`, REST API, discovery routes, minimal pages; `scheduled` cron → `purgeExpired`. |

### `public/` (minimal pages only)

- `sign-in.html` — email/password login (needed before any browser approval).
- `device.html` — device-authorization approval (human CLI login): enter/confirm
  user code, approve/deny. Maps to the `device-authorization` plugin endpoints.
- `agent-approval.html` — agent capability approval page (the
  `deviceAuthorizationPage` for `agentAuth`): shows the requesting agent + the
  capabilities it wants, approve/deny.

Everything else → 404 or plain text. `ASSETS` binding kept only to serve these.

## Auth design

### Agents — `@better-auth/agent-auth`

```ts
agentAuth({
  providerName: "Agent Email",
  providerDescription: "Disposable @agent.raygen.dev inboxes for AI agents.",
  modes: ["delegated", "autonomous"],
  capabilities: [ create_temp_email, list_temp_emails, list_emails,
                  read_email, delete_temp_email ],
  approvalMethods: ["device_authorization"],
  deviceAuthorizationPage: "/agent-approval",
  onExecute,            // dispatch → email-service, scoped by agentSession.user.id
  onEvent,              // audit log via console/observability
})
```

Flow: agent fetches `/.well-known/agent-configuration` → `/agent/register` →
`/agent/request-capability` → user approves at `/agent-approval` → agent signs a
short-lived JWT and calls `/capability/execute` → plugin verifies JWT + grant →
`onExecute` runs the email operation as that user.

Discovery: expose `/.well-known/agent-configuration` from the app root via
`auth.api.getAgentConfiguration()` (separate from the `/api/auth` base path).

### Human CLI — Device Authorization + bearer

- `deviceAuthorization()` plugin: CLI `POST /api/auth/device/code` →
  `{user_code, verification_uri, interval, expires_in}` → poll
  `POST /api/auth/device/token` until approved → receive session `access_token`.
- `bearer()` plugin: CLI sends `Authorization: Bearer <session-token>` to the
  REST API; `auth.api.getSession({ headers })` validates it.

## REST API (CLI ↔ service), all session-protected

| Method | Path | Maps to |
|--------|------|---------|
| POST | `/api/emails` | `createTempEmail(userId, {prefix?, ttlMinutes?})` |
| GET | `/api/emails` | `listTempEmails(userId)` |
| DELETE | `/api/emails/:address` | `deleteTempEmail(userId, address)` |
| GET | `/api/emails/:address/messages` | `listMessages(userId, address)` |
| GET | `/api/messages/:id` | `readMessage(userId, id)` |

Agent management reuses agent-auth's own session-protected endpoints
(`/api/auth/agent/list`, `/api/auth/agent/revoke`) via the same bearer token —
no custom endpoints needed for that.

## The CLI (`cli/`)

Node + TypeScript, `commander`, native `fetch`. Config at
`~/.config/agent-email/config.json` (mode `0600`): `{ baseUrl, token, user }`.

Commands:

| Command | Behaviour |
|---------|-----------|
| `login` | Device grant. Print code + URL, poll honoring `interval`/`slow_down`, stop on `expired_token`. Store token + identity. |
| `logout` | Revoke session, clear config. |
| `whoami` | Show current identity (re-prompt login on 401). |
| `new [--prefix p] [--ttl m]` | Create a temp address. |
| `ls` | List active addresses. |
| `rm <address>` | Delete an address + its mail. |
| `inbox <address> [--watch]` | List messages; `--watch` polls for new ones. |
| `read <id>` | Print full message. |
| `receive [--prefix p] [--ttl m] [--timeout s]` | **One-shot:** create → watch → print first message → **always delete the address on exit** (success, timeout, or Ctrl-C via signal handler / `finally`). |
| `agents ls` | List connected agents (agent-auth `/agent/list`). |
| `agents revoke <id>` | Revoke an agent (agent-auth `/agent/revoke`). |

Distribution: workspace package in this repo, runnable via `pnpm`/`node`, with a
`bin` entry so it can be linked/installed as `agent-email`. (Open item: publish
to npm vs. local-only — see Open questions.)

## Data model

Existing app tables (`temp_emails`, `received_emails`) keep their shape; the
address column now stores `e-<tag>@agent.raygen.dev`. New tables come from the
plugins:

- agent-auth: `agent`, `agentHost`, `agentCapabilityGrant`, `approvalRequest`
  (+ any JWK storage the plugin requires).
- device-authorization: `deviceCode` (or equivalent).

These are generated with `@better-auth/cli generate` against the auth config and
committed as a numbered migration (`migrations/002_agent_auth.sql`), then applied
to remote D1 with `wrangler d1 execute --remote`. Hand-editing table DDL is
avoided to prevent drift from the plugin's expected schema.

## Robustness / self-sufficiency

- **Worker:** `scheduled` cron (e.g. every 15 min) → `purgeExpired()` removes
  expired addresses and their orphaned messages. Inbound handler rejects mail to
  unknown/expired addresses.
- **CLI:** device-poll backoff respects `interval` + `slow_down`; auto re-login
  prompt on 401; `receive` guarantees cleanup of its address even on
  interruption; clear errors, non-zero exit codes for scripting.

## Error handling

- REST API: 401 (no/invalid session), 403 (not owner), 404 (missing), 400
  (validation). JSON error bodies `{ error, message }`.
- `onExecute`: throws map to agent-auth execution errors; unknown capability →
  explicit error.
- Inbound: `message.setReject(...)` for unknown/expired recipients.

## Testing & verification

- Unit: `email-service` functions against a local D1 (miniflare/vitest) —
  ownership scoping, TTL expiry, purge.
- Integration: deploy to the real Worker; then
  1. `agent-email login` (device flow) end to end.
  2. `agent-email new` → send a real email to the address → `agent-email inbox`
     / `read` shows it.
  3. `agent-email receive` → send mail → prints + auto-deletes.
  4. Register an agent (agent-auth CLI/client), approve at `/agent-approval`,
     execute `list_temp_emails` capability, confirm scoping to the user.
- No success claim without command output as evidence.

## Deployment steps

1. `pnpm add @better-auth/agent-auth` (done) + `commander` for the CLI.
2. Generate + commit `migrations/002_agent_auth.sql`; apply to remote D1.
3. Ensure `AUTH_SECRET` secret is set (`wrangler secret put`).
4. `pnpm run deploy`.
5. Run the verification checklist above against the deployed Worker.

## Open questions

1. **CLI distribution** — local workspace bin only, or set up for `npm publish`
   / `npx agent-email`? (Defaulting to workspace bin + `bin` field; easy to
   publish later.)
2. **Cron cadence** for `purgeExpired` — 15 min assumed; adjust if desired.
```
