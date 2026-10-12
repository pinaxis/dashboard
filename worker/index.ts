import { accessKeys, verifyAccess } from "./access.ts";
import type { AccessKey } from "./access.ts";
import { gitHub } from "./github.ts";
import type { CrawlStatus, GitHub } from "./github.ts";
import { expiring } from "./memo.ts";
import { handle } from "./routes.ts";
import { route } from "./site.ts";

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  GITHUB_TOKEN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

const ORIGIN = "https://pinaxis.intisy.dev";
const outbound = (input: string, init?: RequestInit): Promise<Response> => fetch(input, init);

/**
 * @remarks each status read costs about five GitHub calls and an open tab polls every 15 s, so a
 * short shared cache keeps a few idle tabs from spending the token's hourly rate limit.
 */
const statusCache = expiring<CrawlStatus>(10_000);

let teamKeys: ((refresh: boolean) => Promise<AccessKey[]>) | null = null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    teamKeys ??= accessKeys(env.ACCESS_TEAM_DOMAIN, outbound);
    const keys = teamKeys;
    const verify = (token: string | null) =>
      verifyAccess(token, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD, keys });
    const crawl = async (incoming: Request): Promise<Response> => {
      const direct = gitHub(env.GITHUB_TOKEN, outbound);
      const github: GitHub = { ...direct, status: () => statusCache.get(() => direct.status()) };
      const response = await handle(incoming, { github, verify, origin: ORIGIN });
      if (incoming.method === "POST") {
        statusCache.clear();
      }
      return response;
    };
    return route(request, { verify, assets: env.ASSETS, crawl, origin: ORIGIN });
  },
};
