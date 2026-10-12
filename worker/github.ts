export type Workflow = "scan" | "resume";

export interface Run {
  workflow: Workflow;
  status: string;
  conclusion: string | null;
  url: string;
  startedAt: string;
}

export interface LockState {
  held: boolean;
  holder?: string;
  since?: string;
}

export interface CrawlStatus {
  lock: LockState;
  paused: boolean;
  current: Run | null;
  last: Run | null;
}

export interface StartInputs {
  mode: "full" | "test";
  targets?: string;
  maxSearches?: number;
  discoveryPages?: number;
}

export interface GitHub {
  status(): Promise<CrawlStatus>;
  start(inputs: StartInputs): Promise<void>;
  pause(): Promise<void>;
  cancelCurrent(): Promise<string | null>;
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface RawRun {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  run_started_at?: string;
  created_at: string;
}

interface ListedRun extends Run {
  id: number;
}

interface GitRef {
  object: { type: string; sha: string };
}

const API = "https://api.github.com";
const WORKFLOW_FILES: Record<Workflow, string> = { scan: "scan.yml", resume: "resume.yml" };
const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);
const PAUSE_REF = "tags/crawl-paused";

export function dispatchInputs(inputs: StartInputs): Record<string, string> {
  return {
    test: String(inputs.mode === "test"),
    targets: inputs.targets ?? "",
    max_searches: inputs.maxSearches === undefined ? "" : String(inputs.maxSearches),
    discovery_pages: inputs.discoveryPages === undefined ? "" : String(inputs.discoveryPages),
  };
}

function publicRun(run: ListedRun): Run {
  return { workflow: run.workflow, status: run.status, conclusion: run.conclusion, url: run.url, startedAt: run.startedAt };
}

export function gitHub(token: string, fetcher: Fetcher, repo = "pinaxis/pinaxis"): GitHub {
  function send(path: string, init: RequestInit = {}): Promise<Response> {
    return fetcher(`${API}/repos/${repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "pinaxis-dashboard",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  }

  function failure(path: string, init: RequestInit, response: Response): Error {
    return new Error(`GitHub ${init.method ?? "GET"} ${path || "/"}: HTTP ${response.status}`);
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await send(path, init);
    if (!response.ok) {
      throw failure(path, init, response);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  /** @implNote only a definite 404 means "no such ref"; anything else fails, as GitHubPause does. */
  async function ref(name: string): Promise<GitRef | null> {
    const path = `/git/ref/${name}`;
    const response = await send(path);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw failure(path, {}, response);
    }
    return (await response.json()) as GitRef;
  }

  async function lockState(): Promise<LockState> {
    const found = await ref("tags/crawl-lock");
    if (!found) {
      return { held: false };
    }
    if (found.object.type !== "tag") {
      return { held: true };
    }
    const tag = await request<{ message: string; tagger?: { date?: string } }>(`/git/tags/${found.object.sha}`);
    return { held: true, holder: tag.message.trim(), since: tag.tagger?.date };
  }

  const isPaused = async (): Promise<boolean> => (await ref(PAUSE_REF)) !== null;

  async function listRuns(): Promise<ListedRun[]> {
    const workflows = Object.keys(WORKFLOW_FILES) as Workflow[];
    const lists = await Promise.all(workflows.map(async (workflow) => {
      const body = await request<{ workflow_runs: RawRun[] }>(
        `/actions/workflows/${WORKFLOW_FILES[workflow]}/runs?per_page=10`);
      return body.workflow_runs.map((raw): ListedRun => ({ id: raw.id, workflow, status: raw.status,
        conclusion: raw.conclusion, url: raw.html_url, startedAt: raw.run_started_at ?? raw.created_at }));
    }));
    return lists.flat().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }

  const defaultBranch = async (): Promise<string> =>
    (await request<{ default_branch: string }>("")).default_branch;

  async function pause(): Promise<void> {
    if (await isPaused()) {
      return;
    }
    const branch = await defaultBranch();
    const head = await ref(`heads/${branch}`);
    if (!head) {
      throw new Error(`the default branch ${branch} has no ref`);
    }
    const init = { method: "POST", body: JSON.stringify({ ref: `refs/${PAUSE_REF}`, sha: head.object.sha }) };
    const response = await send("/git/refs", init);
    if (response.ok || (response.status === 422 && await isPaused())) {
      return;
    }
    throw failure("/git/refs", init, response);
  }

  return {
    async status() {
      const [lock, paused, runs] = await Promise.all([lockState(), isPaused(), listRuns()]);
      const current = runs.find((run) => ACTIVE.has(run.status));
      const last = runs.find((run) => run.status === "completed");
      return { lock, paused, current: current ? publicRun(current) : null, last: last ? publicRun(last) : null };
    },
    async start(inputs) {
      const branch = await defaultBranch();
      await request("/actions/workflows/scan.yml/dispatches",
        { method: "POST", body: JSON.stringify({ ref: branch, inputs: dispatchInputs(inputs) }) });
    },
    pause,
    async cancelCurrent() {
      await pause();
      const current = (await listRuns()).find((run) => ACTIVE.has(run.status));
      if (!current) {
        return null;
      }
      await request(`/actions/runs/${current.id}/cancel`, { method: "POST" });
      return current.url;
    },
  };
}
