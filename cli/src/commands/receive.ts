import type { ApiClient } from "../client.js";

interface ReceiveOpts { prefix?: string; ttlMinutes?: number; pollMs?: number; timeoutMs?: number; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = (a: string) => encodeURIComponent(a);

export async function runReceive(client: ApiClient, opts: ReceiveOpts): Promise<void> {
  const pollMs = opts.pollMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const created = await client.post<{ address: string }>("/api/emails", { prefix: opts.prefix, ttl_minutes: opts.ttlMinutes });
  const address = created.address;
  console.log(`Watching ${address} (Ctrl-C to stop)...`);

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return; cleaned = true;
    await client.del(`/api/emails/${enc(address)}`).catch(() => {});
    console.log(`Deleted ${address}.`);
  };
  const onSig = () => { cleanup().finally(() => process.exit(0)); };
  process.on("SIGINT", onSig); process.on("SIGTERM", onSig);

  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { messages } = await client.get<{ messages: { id: number; sender: string; subject: string }[] }>(`/api/emails/${enc(address)}/messages`);
      if (messages.length) {
        const m = messages[0];
        const full = await client.get<{ subject: string; sender: string; body_text?: string; body_html?: string }>(`/api/messages/${m.id}`);
        console.log(`\nFrom: ${full.sender}\nSubject: ${full.subject}\n\n${full.body_text || full.body_html || "(empty)"}\n`);
        return;
      }
      await sleep(pollMs);
    }
    console.log("Timed out waiting for email.");
  } finally {
    process.off("SIGINT", onSig); process.off("SIGTERM", onSig);
    await cleanup();
  }
}
