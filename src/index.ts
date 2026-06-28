import { Hono } from "hono";
import { createAuth } from "./auth";
import { restApi } from "./rest-api";
import { handleInboundEmail } from "./email-handler";
import { purgeExpired } from "./email-service";

const app = new Hono<{ Bindings: CloudflareBindings }>();

// better-auth (login, device flow, agent-auth endpoints, its own .well-known/*)
app.all("/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// CLI REST API (session/bearer protected inside the router)
app.route("/api", restApi);

// Agent Auth discovery document at the app root (separate from /api/auth base path)
app.get("/.well-known/agent-configuration", async (c) => {
  const auth = createAuth(c.env);
  const config = await auth.api.getAgentConfiguration();
  return c.json(config);
});

// Minimal browser pages (served from ASSETS)
for (const path of ["/sign-in", "/device", "/agent-approval"]) {
  app.get(path, (c) => c.env.ASSETS.fetch(new Request(new URL(`${path}.html`, c.req.url))));
}

app.get("/", (c) => c.text("Agent Email — agent-auth provider. Discovery: /.well-known/agent-configuration"));
app.all("*", (c) => c.text("Not found", 404));

export default {
  fetch: app.fetch,
  async email(message: ForwardableEmailMessage, env: CloudflareBindings) {
    await handleInboundEmail(message, env);
  },
  async scheduled(_event: ScheduledController, env: CloudflareBindings) {
    const removed = await purgeExpired(env);
    console.log(`purgeExpired removed ${removed} expired address(es)`);
  },
} satisfies ExportedHandler<CloudflareBindings>;
