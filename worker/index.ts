import { accessKeys, verifyAccess } from "./access.ts";
import type { AccessKey } from "./access.ts";
import { gitHub } from "./github.ts";
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

let teamKeys: ((refresh: boolean) => Promise<AccessKey[]>) | null = null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!API_PATH.test(new URL(request.url).pathname)) {
      return env.ASSETS.fetch(request);
    }
    teamKeys ??= accessKeys(env.ACCESS_TEAM_DOMAIN, outbound);
    const keys = teamKeys;
    return handle(request, {
      github: gitHub(env.GITHUB_TOKEN, outbound),
      verify: (token) => verifyAccess(token, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD, keys }),
      origin: ORIGIN,
    });
  },
};
