export interface SiteDeps {
  verify: (token: string | null) => Promise<boolean>;
  assets: { fetch(request: Request): Promise<Response> };
  crawl: (request: Request) => Promise<Response>;
  origin: string;
}

const LOGIN = /^\/login\/?$/;
const GRAPH = /^\/api\/graph\/?$/;
const CATALOG = /^\/api\/catalog\/?$/;
const CRAWL = /^\/api\/crawl(\/|$)/;
const LEGACY = /^\/private(\/|$)/;
const GRAPH_ASSET = "/api/graph.json";
const CATALOG_ASSET = "/api/catalog.json";

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

async function privateAsset(request: Request, deps: SiteDeps, assetPath: string, missing: string): Promise<Response> {
  if (request.method !== "GET") {
    return reply(405, { error: "method not allowed" });
  }
  const asset = await deps.assets.fetch(new Request(new URL(assetPath, request.url)));
  if (!asset.ok) {
    return reply(503, { error: missing });
  }
  return new Response(asset.body, {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
}

/**
 * @remarks every path except the legacy redirect is verified here, even though Access gates them at
 * the edge: on 2026-10-12 the Access paths and the Worker routes drifted apart and a static private
 * graph was world-readable for minutes. With this check a drift yields a 403, never data.
 */
export async function route(request: Request, deps: SiteDeps): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (LEGACY.test(path)) {
    return redirect(`${deps.origin}/login`);
  }
  if (!(await deps.verify(request.headers.get("Cf-Access-Jwt-Assertion")))) {
    return reply(403, { error: "not signed in through Access" });
  }
  if (LOGIN.test(path)) {
    return redirect(`${deps.origin}/`);
  }
  if (GRAPH.test(path)) {
    return privateAsset(request, deps, GRAPH_ASSET, "the private graph is not deployed");
  }
  if (CATALOG.test(path)) {
    return privateAsset(request, deps, CATALOG_ASSET, "the catalog is not deployed");
  }
  if (CRAWL.test(path)) {
    return deps.crawl(request);
  }
  return reply(404, { error: "not found" });
}
