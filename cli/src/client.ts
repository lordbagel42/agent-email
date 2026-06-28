export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface ClientOpts { baseUrl: string; token?: string; }

export class ApiClient {
  constructor(private opts: ClientOpts, private fetchImpl: typeof fetch = fetch) {}
  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Origin must match a trusted origin or better-auth rejects state-changing
    // requests with "Missing or null Origin" (CSRF protection).
    const headers: Record<string, string> = { accept: "application/json", origin: this.opts.baseUrl };
    if (this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.fetchImpl(this.opts.baseUrl + path, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, data?.message || data?.error || `HTTP ${res.status}`);
    return data as T;
  }
  get<T>(p: string) { return this.req<T>("GET", p); }
  post<T>(p: string, b?: unknown) { return this.req<T>("POST", p, b); }
  del<T>(p: string) { return this.req<T>("DELETE", p); }
}
