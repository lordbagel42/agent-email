import type { ApiClient } from "../client.js";
const enc = (a: string) => encodeURIComponent(a);

export async function listEmails(c: ApiClient) {
  const { addresses } = await c.get<{ addresses: { address: string; expires_at: string }[] }>("/api/emails");
  if (!addresses.length) return console.log("No active addresses.");
  for (const a of addresses) console.log(`${a.address}  (expires ${a.expires_at})`);
}
export async function newEmail(c: ApiClient, opts: { prefix?: string; ttl?: number }) {
  const r = await c.post<{ address: string; expiresAt: string }>("/api/emails", { prefix: opts.prefix, ttl_minutes: opts.ttl });
  console.log(`${r.address}\nExpires: ${r.expiresAt}`);
}
export async function rmEmail(c: ApiClient, address: string) {
  await c.del(`/api/emails/${enc(address)}`); console.log(`Deleted ${address}.`);
}
export async function inbox(c: ApiClient, address: string, watch: boolean) {
  const show = async () => {
    const { messages } = await c.get<{ messages: { id: number; sender: string; subject: string; received_at: string }[] }>(`/api/emails/${enc(address)}/messages`);
    console.clear?.();
    if (!messages.length) console.log("No messages yet.");
    else for (const m of messages) console.log(`[${m.id}] ${m.sender} — ${m.subject} (${m.received_at})`);
  };
  await show();
  if (!watch) return;
  for (;;) { await new Promise((r) => setTimeout(r, 3000)); await show(); }
}
export async function readEmail(c: ApiClient, id: string) {
  const m = await c.get<{ sender: string; recipient: string; subject: string; received_at: string; body_text?: string; body_html?: string }>(`/api/messages/${id}`);
  console.log(`From: ${m.sender}\nTo: ${m.recipient}\nSubject: ${m.subject}\nDate: ${m.received_at}\n\n${m.body_text || m.body_html || "(empty)"}`);
}
