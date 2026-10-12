export interface AccessKey {
  kid: string;
  jwk: JsonWebKey;
}

export interface AccessConfig {
  teamDomain: string;
  audience: string;
  keys: (refresh: boolean) => Promise<AccessKey[]>;
  now?: () => number;
}

const SIGNATURE = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

function decodeSegment(segment: string): Uint8Array {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeJson(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(decodeSegment(segment))) as Record<string, unknown>;
}

function hasAudience(payload: Record<string, unknown>, audience: string): boolean {
  return Array.isArray(payload.aud) ? payload.aud.includes(audience) : payload.aud === audience;
}

function isUnexpired(payload: Record<string, unknown>, now: number): boolean {
  return typeof payload.exp === "number" && payload.exp * 1000 > now;
}

async function findKey(kid: string, config: AccessConfig): Promise<CryptoKey | null> {
  for (const refresh of [false, true]) {
    const match = (await config.keys(refresh)).find((key) => key.kid === kid);
    if (match) {
      return crypto.subtle.importKey("jwk", match.jwk, SIGNATURE, false, ["verify"]);
    }
  }
  return null;
}

/**
 * @remarks Access already gates /private* at the edge; this re-check keeps the crawl controls closed
 * if the route or the Access application ever drifts away from each other.
 */
export async function verifyAccess(token: string | null, config: AccessConfig): Promise<boolean> {
  const parts = token?.split(".") ?? [];
  if (parts.length !== 3) {
    return false;
  }
  try {
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string") {
      return false;
    }
    const key = await findKey(header.kid, config);
    if (!key) {
      return false;
    }
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify(SIGNATURE, key, decodeSegment(parts[2]), signed);
    return valid
      && hasAudience(payload, config.audience)
      && isUnexpired(payload, (config.now ?? Date.now)())
      && payload.iss === `https://${config.teamDomain}`;
  } catch {
    return false;
  }
}

export function accessKeys(
  teamDomain: string,
  fetcher: (input: string) => Promise<Response>,
): (refresh: boolean) => Promise<AccessKey[]> {
  let cached: AccessKey[] | null = null;
  return async (refresh) => {
    if (cached && !refresh) {
      return cached;
    }
    const response = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!response.ok) {
      throw new Error(`Access keys: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { keys: (JsonWebKey & { kid: string })[] };
    cached = body.keys.map((jwk) => ({ kid: jwk.kid, jwk }));
    return cached;
  };
}
