const CLIENT_ID = "agent-email-cli";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface DeviceCodeResponse {
  device_code: string; user_code: string;
  verification_uri: string; verification_uri_complete?: string;
  interval: number; expires_in: number;
}

export async function requestDeviceCode(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<DeviceCodeResponse> {
  const res = await fetchImpl(`${baseUrl}/api/auth/device/code`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!res.ok) throw new Error(`device/code failed: ${res.status}`);
  return res.json();
}

export async function pollDeviceToken(
  baseUrl: string, deviceCode: string, clientId = CLIENT_ID,
  intervalSec = 5, fetchImpl: typeof fetch = fetch, sleepImpl = sleep,
): Promise<string> {
  let interval = Math.max(intervalSec, 1);
  for (;;) {
    const res = await fetchImpl(`${baseUrl}/api/auth/device/token`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: deviceCode, client_id: clientId }),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (res.ok && data.access_token) return data.access_token as string;
    switch (data.error) {
      case "authorization_pending": break;
      case "slow_down": interval += 5; break;
      case "expired_token": throw new Error("Device code expired. Run `agent-email login` again.");
      case "access_denied": throw new Error("Approval was denied.");
      default: throw new Error((data.error_description as string) || (data.error as string) || `device/token failed: ${res.status}`);
    }
    await sleepImpl(interval * 1000);
  }
}
