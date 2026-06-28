import type { ApiClient } from "../client.js";

export async function listAgents(c: ApiClient) {
  // agent-auth exposes session-protected /agent/list
  const res = await c.get<{ agents?: { id: string; name?: string; status: string }[] }>("/api/auth/agent/list");
  const agents = res.agents ?? [];
  if (!agents.length) return console.log("No connected agents.");
  for (const a of agents) console.log(`${a.id}  ${a.name ?? ""}  [${a.status}]`);
}
export async function revokeAgent(c: ApiClient, id: string) {
  await c.post("/api/auth/agent/revoke", { agentId: id });
  console.log(`Revoked agent ${id}.`);
}
