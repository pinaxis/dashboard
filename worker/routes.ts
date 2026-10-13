import type { GitHub, StartInputs } from "./github.ts";
import { parseWeights, formatWeights, validateWeights } from "./priorities.ts";

export interface Deps {
  github: GitHub;
  verify: (token: string | null) => Promise<boolean>;
  origin: string;
}

const START_FIELDS = new Set(["mode", "targets", "maxSearches", "discoveryPages"]);
const TARGETS = /^[a-z0-9-]+(,[a-z0-9-]+)*$/;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const isIntegerIn = (value: unknown, low: number, high: number): boolean =>
  Number.isInteger(value) && (value as number) >= low && (value as number) <= high;

export function validateStart(body: unknown): StartInputs | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "the body must be an object";
  }
  const fields = body as Record<string, unknown>;
  const unknown = Object.keys(fields).filter((field) => !START_FIELDS.has(field));
  if (unknown.length > 0) {
    return `unknown field: ${unknown.join(", ")}`;
  }
  if (fields.mode !== "full" && fields.mode !== "test") {
    return "mode must be full or test";
  }
  if (fields.targets !== undefined && (typeof fields.targets !== "string" || !TARGETS.test(fields.targets))) {
    return "targets must be a comma list of target names";
  }
  if (fields.maxSearches !== undefined && !isIntegerIn(fields.maxSearches, 1, 1000)) {
    return "maxSearches must be an integer from 1 to 1000";
  }
  if (fields.discoveryPages !== undefined && !isIntegerIn(fields.discoveryPages, 1, 10)) {
    return "discoveryPages must be an integer from 1 to 10";
  }
  return { ...fields, mode: fields.mode } as StartInputs;
}

/** @remarks refuses a POST another site could forge while riding the Access cookie. */
function isSameSiteJson(request: Request, origin: string): boolean {
  const type = request.headers.get("Content-Type") ?? "";
  return request.headers.get("Origin") === origin && type.startsWith("application/json");
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

async function guarded(status: number, work: () => Promise<unknown>): Promise<Response> {
  try {
    return reply(status, await work());
  } catch (error) {
    return reply(502, { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (!(await deps.verify(request.headers.get("Cf-Access-Jwt-Assertion")))) {
    return reply(403, { error: "not signed in through Access" });
  }
  const action = new URL(request.url).pathname.replace(/^\/api\/crawl\/?/, "");
  if (request.method === "GET" && action === "") {
    return guarded(200, () => deps.github.status());
  }
  if (action === "priorities") {
    if (request.method === "GET") {
      return reply(200, { weights: parseWeights(await deps.github.getVariable("PINAXIS_WEIGHTS")) });
    }
    if (request.method === "PUT") {
      if (!isSameSiteJson(request, deps.origin)) {
        return reply(403, { error: "cross-site or non-JSON request refused" });
      }
      const weights = validateWeights(await readJson(request));
      if (typeof weights === "string") {
        return reply(400, { error: weights });
      }
      return guarded(200, async () => {
        await deps.github.setVariable("PINAXIS_WEIGHTS", formatWeights(weights));
        return { saved: true };
      });
    }
    return reply(405, { error: "method not allowed" });
  }
  if (request.method !== "POST") {
    return reply(405, { error: "method not allowed" });
  }
  if (!isSameSiteJson(request, deps.origin)) {
    return reply(403, { error: "cross-site or non-JSON request refused" });
  }
  if (action === "start") {
    const inputs = validateStart(await readJson(request));
    if (typeof inputs === "string") {
      return reply(400, { error: inputs });
    }
    return guarded(202, async () => {
      await deps.github.start(inputs);
      return { started: inputs.mode };
    });
  }
  if (action === "pause") {
    return guarded(200, async () => {
      await deps.github.pause();
      return { paused: true };
    });
  }
  if (action === "cancel") {
    return guarded(200, async () => ({ cancelled: await deps.github.cancelCurrent() }));
  }
  return reply(404, { error: "no such crawl action" });
}
