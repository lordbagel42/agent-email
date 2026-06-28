#!/usr/bin/env node
import { Command } from "commander";
import { resolveConfig } from "./config.js";
import { ApiClient, ApiError } from "./client.js";
import { doLogin, doSignup, doLogout, doWhoami } from "./commands/auth.js";
import { listEmails, newEmail, rmEmail, inbox, readEmail } from "./commands/emails.js";
import { runReceive } from "./commands/receive.js";
import { listAgents, revokeAgent } from "./commands/agents.js";
import { listUsers, verifyUser } from "./commands/admin.js";

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

program.command("signup").description("Create a new account").action(() => doSignup(cfg()));
program.command("login").description("Log in via device authorization flow").action(() => doLogin(cfg()));
program.command("logout").description("Log out and clear stored credentials").action(() => doLogout(cfg()));
program.command("whoami").description("Show current logged-in identity").action(() => doWhoami(cfg()));

program.command("new").description("Create a new temporary email address")
  .option("-p, --prefix <p>", "address prefix label")
  .option("-t, --ttl <m>", "lifetime in minutes", (v) => parseInt(v, 10))
  .action((o) => newEmail(authed(), o));
program.command("ls").description("List active temporary email addresses").action(() => listEmails(authed()));
program.command("rm <address>").description("Delete a temporary address and all its messages").action((a) => rmEmail(authed(), a));
program.command("inbox <address>").description("List messages for an address")
  .option("-w, --watch", "poll for new messages")
  .action((a, o) => inbox(authed(), a, !!o.watch));
program.command("read <id>").description("Read a message by ID").action((id) => readEmail(authed(), id));
program.command("receive").description("One-shot: create address, wait for first email, then delete")
  .option("-p, --prefix <p>", "address prefix label")
  .option("-t, --ttl <m>", "lifetime in minutes", (v) => parseInt(v, 10))
  .option("--timeout <s>", "timeout in seconds", (v) => parseInt(v, 10))
  .action((o) => runReceive(authed(), { prefix: o.prefix, ttlMinutes: o.ttl, timeoutMs: o.timeout ? o.timeout * 1000 : undefined }));

const agents = program.command("agents").description("Manage connected agents");
agents.command("ls").description("List connected agents").action(() => listAgents(authed()));
agents.command("revoke <id>").description("Revoke an agent's access").action((id) => revokeAgent(authed(), id));

const adminCmd = program.command("admin").description("Admin: manage users (requires admin role)");
adminCmd.command("ls").description("List users")
  .option("-u, --unverified", "show only unverified users")
  .action((o) => listUsers(authed(), { unverified: !!o.unverified }));
adminCmd.command("verify <emailOrId>").description("Verify a user's email so they can sign in")
  .action((x) => verifyUser(authed(), x));

program.parseAsync().catch((e) => {
  if (e instanceof ApiError && e.status === 401) console.error("Session expired. Run `agent-email login`.");
  else console.error(e.message || String(e));
  process.exit(1);
});
