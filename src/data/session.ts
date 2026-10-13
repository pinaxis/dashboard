import type { GraphDocument } from "./graph.ts";

export const PRIVATE_GRAPH_URL = "/api/graph";
export const LOGIN_URL = "/login";
/** Cloudflare Access serves this on every protected host; it ends the session the private data rides on. */
export const LOGOUT_URL = "/cdn-cgi/access/logout";

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/**
 * @remarks `redirect: "manual"` turns Access's cross-origin login redirect into an opaque answer
 * instead of a CORS failure, so being signed out is an ordinary outcome rather than an error.
 */
export async function probeSession(fetcher: Fetcher = (input, init) => fetch(input, init)): Promise<GraphDocument | null> {
  try {
    const response = await fetcher(PRIVATE_GRAPH_URL, { redirect: "manual", credentials: "same-origin", cache: "no-store" });
    if (response.type === "opaqueredirect" || !response.ok) {
      return null;
    }
    const document = (await response.json()) as { mode?: unknown };
    return document.mode === "private" ? (document as GraphDocument) : null;
  } catch {
    return null;
  }
}
