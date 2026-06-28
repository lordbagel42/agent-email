import { betterAuth } from "better-auth";
import { admin, bearer, deviceAuthorization } from "better-auth/plugins";
import { agentAuth } from "@better-auth/agent-auth";
import type { AgentAuthOptions } from "@better-auth/agent-auth";
import { capabilities, makeOnExecute } from "./capabilities";

// Hardcoded bootstrap admin. This account is auto-verified and given the admin
// role on creation, so it can verify other users (admin-approval is the only
// verification path — no outbound email is sent).
export const ADMIN_EMAIL = "raygenrrupe@gmail.com";

export function createAuth(env: CloudflareBindings) {
  const agentAuthOptions: AgentAuthOptions = {
    providerName: "Agent Email",
    providerDescription: "Disposable @agent.raygen.dev inboxes for AI agents.",
    // Delegated only: an agent can act ONLY on behalf of a human who approves it
    // in the browser. Because sign-in requires a verified email, every approver
    // is verified — so agents can never bypass admin-approval to provision an
    // account. Autonomous mode is intentionally disabled (it would otherwise be
    // a self-provisioning path the moment a resolveAutonomousUser is added).
    modes: ["delegated"],
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
    emailAndPassword: {
      enabled: true,
      // New accounts are unverified and cannot sign in until an admin approves
      // them. No sender is configured, so no verification email is sent — the
      // admin verifies users via `agent-email admin verify <email>`.
      requireEmailVerification: true,
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (user.email?.toLowerCase() === ADMIN_EMAIL) {
              return { data: { ...user, role: "admin", emailVerified: true } };
            }
            return;
          },
        },
      },
    },
    trustedOrigins: [env.AUTH_URL],
    plugins: [
      agentAuth(agentAuthOptions),
      admin(),
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
