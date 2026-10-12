import { accessKeys, verifyAccess } from "./access.ts";
import type { AccessKey } from "./access.ts";
import { gitHub } from "./github.ts";
import type { CrawlStatus, GitHub } from "./github.ts";
import { expiring } from "./memo.ts";
import { handle } from "./routes.ts";

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  GITHUB_TOKEN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

const ORIGIN = "https://pinaxis.intisy.dev";
const API_PATH = /^\/private\/api\/crawl(\/|$)/;
const outbound = (input: string, init?: RequestInit): Promise<Response> => fetch(input, init);

/**
 * @remarks each status read costs about five GitHub calls and an open tab polls every 15 s, so a
 * short shared cache keeps a few idle tabs from spending the token's hourly rate limit.
 */
const statusCache = expiring<CrawlStatus>(10_000);

let teamKeys: ((refresh: boolean) => Promise<AccessKey[]>) | null = null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!API_PATH.test(new URL(request.url).pathname)) {
      return env.ASSETS.fetch(request);
    }
    teamKeys ??= accessKeys(env.ACCESS_TEAM_DOMAIN, outbound);
    const keys = teamKeys;
    const direct = gitHub(env.GITHUB_TOKEN, outbound);
    const github: GitHub = { ...direct, status: () => statusCache.get(() => direct.status()) };
    const response = await handle(request, {
      github,
      verify: (token) => verifyAccess(token, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD, keys }),
      origin: ORIGIN,
    });
    if (request.method === "POST") {
      statusCache.clear();
    }
    return response;
  },
};
