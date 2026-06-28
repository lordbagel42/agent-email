import type { Capability } from "@better-auth/agent-auth";
import {
  createTempEmail, listTempEmails, deleteTempEmail, listMessages, readMessage,
} from "./email-service";

export const capabilities: Capability[] = [
  {
    name: "create_temp_email",
    description: "Create a temporary e-<tag>@agent.raygen.dev address. Returns the address and its expiry.",
    input: {
      type: "object",
      properties: {
        prefix: { type: "string", description: "Optional label, e.g. 'signup'." },
        ttl_minutes: { type: "number", description: "Lifetime in minutes (1-1440, default 60)." },
      },
    },
  },
  { name: "list_temp_emails", description: "List your active temporary addresses." },
  {
    name: "list_emails",
    description: "List emails received at one of your temporary addresses.",
    input: { type: "object", properties: { address: { type: "string" } }, required: ["address"] },
  },
  {
    name: "read_email",
    description: "Read a received email by numeric id.",
    input: { type: "object", properties: { email_id: { type: "number" } }, required: ["email_id"] },
  },
  {
    name: "delete_temp_email",
    description: "Delete a temporary address and all of its received email.",
    input: { type: "object", properties: { address: { type: "string" } }, required: ["address"] },
  },
];

type ExecCtx = {
  capability: string;
  arguments?: Record<string, unknown>;
  agentSession: {
    user?: { id?: string } | null;
    userId?: string | null;
  };
};

export function makeOnExecute(env: CloudflareBindings) {
  return async function onExecute(ctx: ExecCtx): Promise<unknown> {
    const userId = ctx.agentSession.user?.id ?? ctx.agentSession.userId ?? null;
    if (!userId) throw new Error("Agent has no resolved user; approval required.");
    const args = ctx.arguments ?? {};
    switch (ctx.capability) {
      case "create_temp_email":
        return createTempEmail(env, userId, {
          prefix: args.prefix as string | undefined,
          ttlMinutes: args.ttl_minutes as number | undefined,
        });
      case "list_temp_emails":
        return { addresses: await listTempEmails(env, userId) };
      case "list_emails": {
        const msgs = await listMessages(env, userId, String(args.address));
        if (msgs === null) throw new Error("Address not found, not yours, or expired.");
        return { messages: msgs };
      }
      case "read_email": {
        const m = await readMessage(env, userId, Number(args.email_id));
        if (!m) throw new Error("Email not found or not accessible.");
        return m;
      }
      case "delete_temp_email": {
        const ok = await deleteTempEmail(env, userId, String(args.address));
        if (!ok) throw new Error("Address not found or not yours.");
        return { deleted: true };
      }
      default:
        throw new Error(`Unsupported capability: ${ctx.capability}`);
    }
  };
}
