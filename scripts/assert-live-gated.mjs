import { fileURLToPath } from "node:url";

const ORIGIN = "https://pinaxis.intisy.dev";
const GATED = ["/login", "/api/graph", "/api/catalog", "/api/crawl", "/api/crawl/priorities", "/private/graph.json"];
const LEGACY = "/private/graph.json";
const ACCESS_LOGIN = /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\/cdn-cgi\/access\/login\//;

function isGatedAnswer(path, response, origin) {
  if (response.status === 403) {
    return true;
  }
  const location = response.headers.get("location") ?? "";
  const toLogin = path === LEGACY && location === `${origin}/login`;
  return response.status === 302 && (ACCESS_LOGIN.test(location) || toLogin);
}

/**
 * @remarks run signed out, after every private deploy: the 2026-10-12 leak was a path the Access
 * application stopped covering while the Worker still served it, which only a request from outside
 * can see.
 */
export async function checkLiveGated(origin, fetcher) {
  const failures = [];
  for (const path of GATED) {
    const response = await fetcher(`${origin}${path}`, { redirect: "manual" });
    if (!isGatedAnswer(path, response, origin)) {
      failures.push(`${path} answered ${response.status} ${response.headers.get("location") ?? ""}`.trim());
    }
  }
  const publicGraph = await fetcher(`${origin}/graph.json`, { redirect: "manual" });
  const body = publicGraph.status === 200 ? await publicGraph.json().catch(() => null) : null;
  if (body?.mode !== "public") {
    failures.push(`/graph.json answered ${publicGraph.status} without a public-mode document`);
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = await checkLiveGated(process.argv[2] ?? ORIGIN, (url, init) => fetch(url, init));
  if (failures.length > 0) {
    console.error(`NOT GATED, fix before anything else:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`every private path is gated, and the public graph is served (${GATED.length + 1} checks)`);
}
