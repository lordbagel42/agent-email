import PostalMime from "postal-mime";
import { storeInbound } from "./email-service";

export async function handleInboundEmail(
  message: ForwardableEmailMessage, env: CloudflareBindings,
): Promise<void> {
  const rawBuffer = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(rawBuffer);
  const result = await storeInbound(env, {
    recipient: message.to,
    sender: message.from,
    subject: parsed.subject || "(no subject)",
    text: parsed.text ?? null,
    html: parsed.html ?? null,
    messageId: message.headers.get("message-id"),
  });
  if (result === "rejected") message.setReject("Address not found or expired");
}
