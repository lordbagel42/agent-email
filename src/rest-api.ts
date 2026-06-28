import { Hono } from "hono";
import { createAuth } from "./auth";
import {
  createTempEmail, listTempEmails, deleteTempEmail, listMessages, readMessage,
} from "./email-service";

type Vars = { userId: string };
export const restApi = new Hono<{ Bindings: CloudflareBindings; Variables: Vars }>();

restApi.use("*", async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user?.id) return c.json({ error: "unauthorized", message: "Sign in first." }, 401);
  c.set("userId", session.user.id);
  await next();
});

restApi.post("/emails", async (c) => {
  const body = await c.req.json<{ prefix?: string; ttl_minutes?: number }>().catch((): { prefix?: string; ttl_minutes?: number } => ({}));
  const res = await createTempEmail(c.env, c.get("userId"), { prefix: body.prefix, ttlMinutes: body.ttl_minutes });
  return c.json(res, 201);
});

restApi.get("/emails", async (c) =>
  c.json({ addresses: await listTempEmails(c.env, c.get("userId")) }));

restApi.delete("/emails/:address", async (c) => {
  const ok = await deleteTempEmail(c.env, c.get("userId"), c.req.param("address"));
  return ok ? c.json({ deleted: true }) : c.json({ error: "not_found", message: "Address not found or not yours." }, 404);
});

restApi.get("/emails/:address/messages", async (c) => {
  const msgs = await listMessages(c.env, c.get("userId"), c.req.param("address"));
  return msgs === null
    ? c.json({ error: "not_found", message: "Address not found, not yours, or expired." }, 404)
    : c.json({ messages: msgs });
});

restApi.get("/messages/:id", async (c) => {
  const m = await readMessage(c.env, c.get("userId"), Number(c.req.param("id")));
  return m ? c.json(m) : c.json({ error: "not_found", message: "Email not found." }, 404);
});
