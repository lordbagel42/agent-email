import type { ApiClient } from "../client.js";

export interface AdminUser {
  id: string;
  email: string;
  emailVerified: boolean;
  role?: string | null;
  createdAt?: string;
}

interface ListUsersResponse {
  users: AdminUser[];
  total?: number;
}

// better-auth admin plugin: GET /api/auth/admin/list-users (admin-gated).
async function fetchUsers(c: ApiClient): Promise<AdminUser[]> {
  const res = await c.get<ListUsersResponse>("/api/auth/admin/list-users?limit=200");
  return res.users ?? [];
}

export function filterUnverified(users: AdminUser[]): AdminUser[] {
  return users.filter((u) => !u.emailVerified);
}

export function findUserByEmailOrId(users: AdminUser[], needle: string): AdminUser | undefined {
  const n = needle.toLowerCase();
  return users.find((u) => u.id === needle || u.email.toLowerCase() === n);
}

export async function listUsers(c: ApiClient, opts: { unverified?: boolean }): Promise<void> {
  const all = await fetchUsers(c);
  const users = opts.unverified ? filterUnverified(all) : all;
  if (!users.length) {
    console.log(opts.unverified ? "No unverified users." : "No users.");
    return;
  }
  for (const u of users) {
    const flags = [u.emailVerified ? "verified" : "UNVERIFIED", u.role ?? "user"].join(", ");
    console.log(`${u.id}  ${u.email}  [${flags}]`);
  }
}

export async function verifyUser(c: ApiClient, emailOrId: string): Promise<void> {
  const user = findUserByEmailOrId(await fetchUsers(c), emailOrId);
  if (!user) {
    console.error(`No user matching "${emailOrId}".`);
    process.exit(1);
  }
  if (user.emailVerified) {
    console.log(`${user.email} is already verified.`);
    return;
  }
  // better-auth admin plugin: POST /api/auth/admin/update-user { userId, data }.
  await c.post("/api/auth/admin/update-user", {
    userId: user.id,
    data: { emailVerified: true },
  });
  console.log(`Verified ${user.email}.`);
}
