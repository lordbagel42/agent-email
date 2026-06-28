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
