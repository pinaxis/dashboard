export const CATALOG_URL = "/api/catalog";

export interface RuleInfo {
  prefix: string;
  regex: string;
  length: number | null;
}

export interface TargetInfo {
  name: string;
  category: string;
  kind: string;
  secret: boolean;
  verification: string;
  weight: number;
  rateLimitPerMinute: number | null;
  validationEndpoint: string | null;
  prefixRules: RuleInfo[];
}

export async function loadCatalog(fetcher: typeof fetch = fetch): Promise<TargetInfo[]> {
  try {
    const response = await fetcher(CATALOG_URL, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      return [];
    }
    const body = await response.json();
    return Array.isArray(body) ? (body as TargetInfo[]) : [];
  } catch {
    return [];
  }
}

export function catalogByName(entries: TargetInfo[]): Map<string, TargetInfo> {
  return new Map(entries.map((entry) => [entry.name, entry]));
}
