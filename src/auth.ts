import { betterAuth } from "better-auth";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { agentAuth } from "@better-auth/agent-auth";
import type { AgentAuthOptions } from "@better-auth/agent-auth";
import { capabilities, makeOnExecute } from "./capabilities";

export function createAuth(env: CloudflareBindings) {
  const agentAuthOptions: AgentAuthOptions = {
    providerName: "Agent Email",
    providerDescription: "Disposable @agent.raygen.dev inboxes for AI agents.",
    modes: ["delegated", "autonomous"],
    capabilities,
    approvalMethods: ["device_authorization"],
    deviceAuthorizationPage: "/agent-approval",
    onExecute: makeOnExecute(env) as AgentAuthOptions["onExecute"],
    onEvent: (event) => { console.log("agent-auth", JSON.stringify(event)); },
  };

  return betterAuth({
    database: env.DB,
    baseURL: env.AUTH_URL,
    secret: (env as unknown as Record<string, string>).AUTH_SECRET,
    emailAndPassword: { enabled: true },
    trustedOrigins: [env.AUTH_URL],
    plugins: [
      agentAuth(agentAuthOptions),
      bearer(),
      // deviceAuthorization() MUST come after agentAuth: both plugins expose an
      // endpoint under the object key `deviceCode`, and better-auth keeps only the
      // last one. Ordering device-authorization last ensures the human-CLI device
      // login route (/api/auth/device/code) wins over agent-auth's
      // /agent/device/code (which we don't use — agents approve via the browser
      // capability-grant flow, not RFC-8628 agent enrollment).
      deviceAuthorization(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
