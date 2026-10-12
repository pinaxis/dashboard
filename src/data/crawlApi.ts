import type { CrawlStatus, StartInputs } from "../../worker/github.ts";

export type { CrawlStatus, StartInputs };

const BASE = "/private/api/crawl";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { credentials: "same-origin", ...init });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return body as T;
}

function post<T>(action: string, payload: unknown = {}): Promise<T> {
  return call<T>(`/${action}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

export const crawlApi = {
  status: () => call<CrawlStatus>(""),
  start: (inputs: StartInputs) => post<{ started: string }>("start", inputs),
  pause: () => post<{ paused: boolean }>("pause"),
  cancel: () => post<{ cancelled: string | null }>("cancel"),
};
