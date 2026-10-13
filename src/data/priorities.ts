import type { TargetInfo } from "./catalog.ts";

export const PRIORITIES_URL = "/api/crawl/priorities";

export interface PriorityRow {
  name: string;
  weight: number;
  overridden: boolean;
}

export async function loadPriorities(fetcher: typeof fetch = fetch): Promise<Record<string, number>> {
  try {
    const response = await fetcher(PRIORITIES_URL, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      return {};
    }
    const body = (await response.json()) as { weights?: Record<string, number> };
    return body.weights ?? {};
  } catch {
    return {};
  }
}

export async function savePriorities(weights: Record<string, number>, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(PRIORITIES_URL, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weights }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
}

export function validatePriorityInput(raw: string): number | null {
  const value = Number(raw);
  return raw.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= 100 ? value : null;
}

export function priorityRows(catalog: TargetInfo[], overrides: Record<string, number>): PriorityRow[] {
  return catalog
    .map((entry) => ({
      name: entry.name,
      weight: overrides[entry.name] ?? entry.weight,
      overridden: entry.name in overrides,
    }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
}
