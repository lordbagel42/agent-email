import { describe, it, expect, vi } from "vitest";
import { filterUnverified, findUserByEmailOrId, verifyUser, type AdminUser } from "../src/commands/admin";

const users: AdminUser[] = [
  { id: "1", email: "Admin@Example.com", emailVerified: true, role: "admin" },
  { id: "2", email: "new@example.com", emailVerified: false, role: "user" },
];

describe("admin helpers", () => {
  it("filters unverified users", () => {
    expect(filterUnverified(users).map((u) => u.id)).toEqual(["2"]);
  });
  it("finds by email case-insensitively and by id", () => {
    expect(findUserByEmailOrId(users, "ADMIN@example.com")?.id).toBe("1");
    expect(findUserByEmailOrId(users, "2")?.email).toBe("new@example.com");
    expect(findUserByEmailOrId(users, "missing")).toBeUndefined();
  });
});

describe("verifyUser", () => {
  it("posts update-user with emailVerified for the matched user", async () => {
    const post = vi.fn(async () => ({}));
    const client = {
      get: vi.fn(async () => ({ users })),
      post,
    } as any;
    await verifyUser(client, "new@example.com");
    expect(post).toHaveBeenCalledWith("/api/auth/admin/update-user", {
      userId: "2",
      data: { emailVerified: true },
    });
  });

  it("does not re-verify an already-verified user", async () => {
    const post = vi.fn(async () => ({}));
    const client = { get: vi.fn(async () => ({ users })), post } as any;
    await verifyUser(client, "1");
    expect(post).not.toHaveBeenCalled();
  });
});
