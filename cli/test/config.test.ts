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
