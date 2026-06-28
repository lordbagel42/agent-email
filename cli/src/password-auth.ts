export type SignInResult =
  | { status: "ok"; token: string }
  | { status: "unverified" };

// Sign in with email + password and return the bearer session token (exposed by
// better-auth's bearer plugin via the `set-auth-token` response header). Returns
// "unverified" when the account exists but hasn't been admin-approved yet, so
// callers can show guidance instead of failing.
export async function passwordSignIn(
  baseUrl: string,
  email: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SignInResult> {
  const res = await fetchImpl(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  if (res.ok) {
    const token = res.headers.get("set-auth-token");
    if (!token) throw new Error("Sign-in succeeded but no session token was returned.");
    return { status: "ok", token };
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 403 && body.code === "EMAIL_NOT_VERIFIED") {
    return { status: "unverified" };
  }
  throw new Error((body.message as string) || `Sign-in failed: ${res.status}`);
}

export async function signUp(
  baseUrl: string,
  email: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email, password, name: email.split("@")[0] }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((body.message as string) || `Signup failed: ${res.status}`);
  }
}
