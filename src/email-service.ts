const DOMAIN = "agent.raygen.dev";
const TAG_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomTag(len = 12): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += TAG_CHARS[b % TAG_CHARS.length];
  return out;
}

export interface TempEmail { address: string; created_at: string; expires_at: string; }
export interface MessageSummary { id: number; sender: string; subject: string; received_at: string; }
export interface MessageFull extends MessageSummary { recipient: string; body_text: string | null; body_html: string | null; }

export async function createTempEmail(
  env: CloudflareBindings, userId: string,
  opts: { prefix?: string; ttlMinutes?: number },
): Promise<{ address: string; expiresAt: string }> {
  const ttl = Math.min(Math.max(opts.ttlMinutes ?? 60, 1), 1440);
  const tag = opts.prefix ? `${opts.prefix}-${randomTag()}` : randomTag();
  const address = `e-${tag}@${DOMAIN}`;
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO temp_emails (address, user_id, created_at, expires_at)
     VALUES (?, ?, datetime('now'), ?)`,
  ).bind(address, userId, expiresAt).run();
  return { address, expiresAt };
}

export async function listTempEmails(env: CloudflareBindings, userId: string): Promise<TempEmail[]> {
  const { results } = await env.DB.prepare(
    `SELECT address, created_at, expires_at FROM temp_emails
     WHERE user_id = ? AND expires_at > datetime('now') ORDER BY created_at DESC`,
  ).bind(userId).all<TempEmail>();
  return results;
}

async function ownsAddress(env: CloudflareBindings, userId: string, address: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM temp_emails WHERE address = ? AND user_id = ? AND expires_at > datetime('now')`,
  ).bind(address, userId).first();
  return !!row;
}

export async function deleteTempEmail(env: CloudflareBindings, userId: string, address: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `DELETE FROM temp_emails WHERE address = ? AND user_id = ?`,
  ).bind(address, userId).run();
  if (!res.meta.changes) return false;
  await env.DB.prepare(`DELETE FROM received_emails WHERE recipient = ?`).bind(address).run();
  return true;
}

export async function listMessages(env: CloudflareBindings, userId: string, address: string): Promise<MessageSummary[] | null> {
  if (!(await ownsAddress(env, userId, address))) return null;
  const { results } = await env.DB.prepare(
    `SELECT id, sender, subject, received_at FROM received_emails
     WHERE recipient = ? ORDER BY received_at DESC LIMIT 100`,
  ).bind(address).all<MessageSummary>();
  return results;
}

export async function readMessage(env: CloudflareBindings, userId: string, id: number): Promise<MessageFull | null> {
  const row = await env.DB.prepare(
    `SELECT re.id, re.recipient, re.sender, re.subject, re.body_text, re.body_html, re.received_at
     FROM received_emails re JOIN temp_emails te ON re.recipient = te.address
     WHERE re.id = ? AND te.user_id = ?`,
  ).bind(id, userId).first<MessageFull>();
  return row ?? null;
}

export async function storeInbound(
  env: CloudflareBindings,
  msg: { recipient: string; sender: string; subject: string; text: string | null; html: string | null; messageId: string | null },
): Promise<"stored" | "rejected"> {
  const active = await env.DB.prepare(
    `SELECT 1 FROM temp_emails WHERE address = ? AND expires_at > datetime('now')`,
  ).bind(msg.recipient).first();
  if (!active) return "rejected";
  await env.DB.prepare(
    `INSERT INTO received_emails (recipient, sender, subject, body_text, body_html, message_id, received_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).bind(msg.recipient, msg.sender, msg.subject, msg.text, msg.html, msg.messageId).run();
  return "stored";
}

export async function purgeExpired(env: CloudflareBindings): Promise<number> {
  await env.DB.prepare(
    `DELETE FROM received_emails WHERE recipient IN
       (SELECT address FROM temp_emails WHERE expires_at <= datetime('now'))`,
  ).run();
  const res = await env.DB.prepare(`DELETE FROM temp_emails WHERE expires_at <= datetime('now')`).run();
  return res.meta.changes ?? 0;
}
