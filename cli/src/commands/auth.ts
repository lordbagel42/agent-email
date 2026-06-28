import { ApiClient } from "../client.js";
import { readStored, writeStored, clearStored, type ResolvedConfig } from "../config.js";
import { requestDeviceCode, pollDeviceToken } from "../device.js";
import { promptLine, promptPassword, closePrompts } from "../prompts.js";
import { passwordSignIn, signUp } from "../password-auth.js";

async function storeSession(cfg: ResolvedConfig, token: string): Promise<{ email?: string }> {
  const client = new ApiClient({ baseUrl: cfg.baseUrl, token });
  const me = await client
    .get<{ user: { id: string; email: string } }>("/api/auth/get-session")
    .catch(() => null);
  writeStored({ ...readStored(), baseUrl: cfg.baseUrl, token, user: me?.user });
  return { email: me?.user?.email };
}

export async function doLogin(cfg: ResolvedConfig): Promise<void> {
  const dc = await requestDeviceCode(cfg.baseUrl);
  console.log(`\n  Open: ${dc.verification_uri_complete || dc.verification_uri}`);
  console.log(`  Code: ${dc.user_code}\n  Waiting for approval...`);
  const token = await pollDeviceToken(cfg.baseUrl, dc.device_code, "agent-email-cli", dc.interval);
  const { email } = await storeSession(cfg, token);
  console.log(`Logged in${email ? ` as ${email}` : ""}.`);
}

export async function doSignup(cfg: ResolvedConfig): Promise<void> {
  const email = await promptLine("Email: ");
  const password = await promptPassword("Password: ");
  closePrompts();
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }
  await signUp(cfg.baseUrl, email, password);

  // New accounts need admin approval before sign-in. Use the password we just
  // collected to sign in directly: verified accounts (e.g. the admin) get a
  // token immediately; otherwise we explain what's needed instead of hanging.
  const result = await passwordSignIn(cfg.baseUrl, email, password);
  if (result.status === "unverified") {
    console.log(
      `\nAccount created for ${email}.\n` +
        "New accounts require admin approval before you can sign in.\n" +
        "Ask an admin to run `agent-email admin verify " + email + "`,\n" +
        "then run `agent-email login`.",
    );
    return;
  }
  const { email: who } = await storeSession(cfg, result.token);
  console.log(`Account created. Logged in${who ? ` as ${who}` : ""}.`);
}

export async function doLogout(cfg: ResolvedConfig): Promise<void> {
  if (cfg.token) {
    await fetch(`${cfg.baseUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, origin: cfg.baseUrl },
    }).catch(() => {});
  }
  clearStored();
  console.log("Logged out.");
}

export async function doWhoami(cfg: ResolvedConfig): Promise<void> {
  if (!cfg.token) {
    console.log("Not logged in. Run `agent-email login`.");
    return;
  }
  const client = new ApiClient({ baseUrl: cfg.baseUrl, token: cfg.token });
  const me = await client.get<{ user?: { email: string } }>("/api/auth/get-session").catch(() => null);
  console.log(me?.user ? `Logged in as ${me.user.email}` : "Session invalid. Run `agent-email login`.");
}
