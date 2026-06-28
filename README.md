# Agent Email

A Cloudflare Worker that gives AI agents disposable `e-<tag>@agent.raygen.dev`
email addresses and lets them read incoming mail. Authentication uses
**[better-auth](https://better-auth.com)** with the
**[`@better-auth/agent-auth`](https://better-auth.com/docs/plugins/agent-auth)**
plugin — agents get capability-scoped, user-approved, short-lived-JWT access via
the [Agent Auth Protocol](https://agentauthprotocol.com). Humans manage the
service through the `agent-email` CLI.

> Replaces the earlier raw MCP-OAuth approach (better-auth's MCP plugin is
> deprecating in favor of capability-based agent auth).

## Architecture

```
AI agents ──Agent Auth Protocol──▶ @better-auth/agent-auth
  (discover → register → request    (capabilities + onExecute)──┐
   capability → user approves                                    │
   → signed JWT → execute)                                       ▼
                                                          ┌───────────────┐
Human (CLI) ──device login──▶ better-auth session ──REST──▶│ email-service │
  agent-email login/new/...   (device-authorization        │ (one source   │
                               + bearer plugins)            │  of truth)    │
                                                            └──────┬────────┘
Inbound mail ──Cloudflare Email Routing──▶ email() handler ───────▶│
                                                                    ▼
                                                                 D1 (SQLite)
```

`src/email-service.ts` is the single source of truth for all email operations;
the agent `onExecute` dispatcher (`src/capabilities.ts`), the CLI REST API
(`src/rest-api.ts`), and the inbound handler (`src/email-handler.ts`) all call
into it.

## Agent capabilities

Exposed to agents via the discovery document at
`/.well-known/agent-configuration`:

| Capability | Description |
|------------|-------------|
| `create_temp_email` | Create an `e-<tag>@agent.raygen.dev` address (optional prefix, TTL 1–1440 min). |
| `list_temp_emails` | List your active addresses. |
| `list_emails` | List emails received at one of your addresses. |
| `read_email` | Read a received email by id. |
| `delete_temp_email` | Delete an address and its email. |

Agents authenticate per the Agent Auth Protocol: they register, request the
capabilities they need, the owning user approves in the browser at
`/agent-approval`, and the agent then calls `/api/auth/capability/execute` with a
short-lived signed JWT.

> Address format is `e-<tag>@agent.raygen.dev` (single-char local prefix +
> hyphen) — required by Cloudflare Email Routing's matching rules.

## CLI

The `agent-email` CLI (in `cli/`) is the human interface. It logs in with the
OAuth 2.0 Device Authorization grant and talks to the REST API with a bearer
token.

### Run via container (GHCR)

```bash
docker run --rm -it \
  -v "$HOME/.config/agent-email:/root/.config/agent-email" \
  ghcr.io/lordbagel42/agent-email login

# headless / CI:
docker run --rm -e AGENT_EMAIL_TOKEN=... ghcr.io/lordbagel42/agent-email ls
```

### Run locally (dev)

```bash
cd cli && pnpm install && pnpm build
node dist/index.js --help
```

### Commands

| Command | Description |
|---------|-------------|
| `signup` | Create an account, then log in. |
| `login` | Device-flow login (prints a code + URL to approve in a browser). |
| `logout` / `whoami` | Clear session / show current identity. |
| `new [-p prefix] [-t ttl]` | Create a temp address. |
| `ls` | List active addresses. |
| `rm <address>` | Delete an address and its mail. |
| `inbox <address> [-w]` | List messages (`-w` watches for new ones). |
| `read <id>` | Print a full message. |
| `receive [-p] [-t] [--timeout s]` | One-shot: create → wait for first email → print → auto-delete. |
| `agents ls` / `agents revoke <id>` | Manage connected agents. |
| `admin ls [-u]` | (admin) List users; `-u` shows only unverified. |
| `admin verify <email\|id>` | (admin) Verify a user so they can sign in. |

Config lives at `~/.config/agent-email/config.json` (mode `0600`). Overridable
via `--token` / `AGENT_EMAIL_TOKEN`, `--url` / `AGENT_EMAIL_URL`, `--config`.

## Accounts & verification

New accounts require **admin approval** before they can sign in (no verification
email is sent). The flow:

1. A user signs up (`agent-email signup` or `/sign-in`). They're created
   **unverified** and sign-in is blocked (`EMAIL_NOT_VERIFIED`).
2. An admin runs `agent-email admin ls -u` to see pending users, then
   `agent-email admin verify <email>`.
3. The user can now log in.

`raygenrrupe@gmail.com` is hardcoded (`ADMIN_EMAIL` in `src/auth.ts`) as a
bootstrap **admin** — on signup it's auto-verified and given the `admin` role, so
it can verify everyone else. Admin powers come from better-auth's `admin` plugin.

**Interaction with agent auth:** agents run in **delegated mode only**. An agent
can act solely on behalf of a human who approves its capability request in the
browser — and since sign-in requires a verified email, every approver is a
verified user. Agents therefore cannot self-provision accounts or bypass
admin-approval. (Autonomous mode is intentionally disabled.)

## Setup / Deploy

```bash
# 1. Apply migrations to remote D1
npx wrangler d1 execute agent-email-db --remote --file=migrations/001_better_auth.sql
npx wrangler d1 execute agent-email-db --remote --file=schema.sql
npx wrangler d1 execute agent-email-db --remote --file=migrations/0002_agent_auth.sql
npx wrangler d1 execute agent-email-db --remote --file=migrations/003_admin.sql

# 2. Set the auth secret (32+ random chars: openssl rand -base64 32)
npx wrangler secret put AUTH_SECRET

# 3. Deploy
pnpm run deploy
```

Configure **Email Routing** for `agent.raygen.dev` with a catch-all rule
pointing at this Worker so inbound mail reaches the `email()` handler.

A `scheduled` cron (every 15 min) purges expired addresses and their messages.

## Development

```bash
pnpm install
pnpm test          # worker: vitest + @cloudflare/vitest-pool-workers (real D1)
pnpm typecheck
pnpm run dev       # local; note Email Routing only fires when deployed

# apply migrations to the local D1 used by `wrangler dev`:
npx wrangler d1 execute agent-email-db --local --file=migrations/001_better_auth.sql
npx wrangler d1 execute agent-email-db --local --file=schema.sql
npx wrangler d1 execute agent-email-db --local --file=migrations/0002_agent_auth.sql
npx wrangler d1 execute agent-email-db --local --file=migrations/003_admin.sql
```

## Notes

- `@better-auth/agent-auth` is pinned at `0.6.2` (the protocol is in active
  development; the version is pinned to avoid surprise breakage).
- Plugin order in `src/auth.ts` matters: `deviceAuthorization()` must be listed
  **after** `agentAuth()` — both register an endpoint under the object key
  `deviceCode`, and better-auth keeps only the last one. This ordering keeps the
  human CLI login route (`/api/auth/device/code`) working. The
  `test/smoke-auth.test.ts` regression test guards this.
