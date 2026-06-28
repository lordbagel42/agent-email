import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ApiClient } from "../client.js";
import { readStored, writeStored, clearStored, type ResolvedConfig } from "../config.js";
import { requestDeviceCode, pollDeviceToken } from "../device.js";

async function prompt(q: string): Promise<string> {
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
  console.log(`Logged in${me?.user ? ` as ${me.user.email}` : ""}.`);
}

export async function doSignup(cfg: ResolvedConfig): Promise<void> {
  const email = await prompt("Email: ");
  const password = await prompt("Password: ");
  const res = await fetch(`${cfg.baseUrl}/api/auth/sign-up/email`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: email.split("@")[0] }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Signup failed: ${(body.message as string) || res.status}`);
  }
  console.log("Account created. Logging in...");
  await doLogin(cfg);
}

export async function doLogout(cfg: ResolvedConfig): Promise<void> {
  if (cfg.token) await fetch(`${cfg.baseUrl}/api/auth/sign-out`, { method: "POST", headers: { authorization: `Bearer ${cfg.token}` } }).catch(() => {});
  clearStored();
  console.log("Logged out.");
}

export async function doWhoami(cfg: ResolvedConfig): Promise<void> {
  if (!cfg.token) { console.log("Not logged in. Run `agent-email login`."); return; }
  const client = new ApiClient({ baseUrl: cfg.baseUrl, token: cfg.token });
  const me = await client.get<{ user?: { email: string } }>("/api/auth/get-session").catch(() => null);
  console.log(me?.user ? `Logged in as ${me.user.email}` : "Session invalid. Run `agent-email login`.");
}
