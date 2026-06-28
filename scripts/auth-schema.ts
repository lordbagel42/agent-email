import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { deviceAuthorization } from "better-auth/plugins";
import { agentAuth } from "@better-auth/agent-auth";

// Generation-only instance: real DB is D1 at runtime.
// capabilities are runtime-only (no effect on SQL schema), so we pass empty array.
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
      capabilities: [],
      approvalMethods: ["device_authorization"],
      deviceAuthorizationPage: "/agent-approval",
    }),
  ],
});
