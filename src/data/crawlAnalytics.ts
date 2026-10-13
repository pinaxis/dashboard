import type { Crawl } from "./graph";

export type TargetStatus = "done" | "queued" | "idle";

export interface TargetProgress {
  target: string;
  discovered: number;
  pending: number;
  percent: number;
  status: TargetStatus;
}

export interface Throughput {
  found: number;
  runs: number;
  avgPerRun: number;
  pending: number;
  etaRuns: number | null;
}

export interface SourceShare {
  source: string;
  pending: number;
  share: number;
}

export function targetProgress(crawl: Crawl): TargetProgress[] {
  return crawl.targets
    .map((row) => {
      const total = row.discovered + row.pending;
      const status: TargetStatus = row.complete ? "done" : row.pending > 0 ? "queued" : "idle";
      return {
        target: row.target,
        discovered: row.discovered,
        pending: row.pending,
        percent: total === 0 ? 0 : Math.round((row.discovered / total) * 100),
        status,
      };
    })
    .sort((a, b) => b.pending - a.pending || b.discovered - a.discovered);
}

export function throughput(crawl: Crawl): Throughput {
  const runs = crawl.runs.length;
  const found = crawl.runs.reduce((sum, run) => sum + run.stored, 0);
  const pending = crawl.targets.reduce((sum, row) => sum + row.pending, 0);
  const avgPerRun = runs === 0 ? 0 : Math.round(found / runs);
  const etaRuns = avgPerRun > 0 && pending > 0 ? Math.ceil(pending / avgPerRun) : null;
  return { found, runs, avgPerRun, pending, etaRuns };
}

export function queueBySource(crawl: Crawl): SourceShare[] {
  const total = crawl.sources.reduce((sum, row) => sum + row.pending, 0) || 1;
  return [...crawl.sources]
    .map((row) => ({ source: row.source, pending: row.pending, share: Math.round((row.pending / total) * 100) }))
    .sort((a, b) => b.pending - a.pending);
}

export interface Stage {
  key: string;
  label: string;
  host: "github" | "gcp" | "either";
  note: string;
}

const STAGES: Stage[] = [
  { key: "start", label: "Start", host: "either", note: "Classify the turn: fresh, continue, or stopped." },
  { key: "lock", label: "Lock", host: "either", note: "Acquire the crawl lock and start the heartbeat." },
  { key: "download", label: "Download", host: "either", note: "Pull the dataset release asset." },
  { key: "seed", label: "Seed", host: "either", note: "Seed the weighted frontier per target and source." },
  { key: "search", label: "Search", host: "either", note: "Sweep GitHub code search with 64 workers." },
  { key: "validate", label: "Validate", host: "either", note: "Live-check found secrets against each endpoint." },
  { key: "store", label: "Store", host: "either", note: "Upsert nodes and edges into the graph." },
  { key: "enrich", label: "Enrich", host: "either", note: "Walk contributors and the follow graph." },
  { key: "flush", label: "Flush", host: "either", note: "Snapshot the frontier and re-upload the dataset." },
  { key: "offload", label: "Offload", host: "either", note: "Decide whether to hand the next turn off." },
  { key: "hop", label: "Hop", host: "gcp", note: "Dispatch the next turn to GitHub Actions or Google Cloud Run." },
];

export function lifecycleStages(): Stage[] {
  return STAGES;
}

export function runSpan(crawl: Crawl): { first: string | null; last: string | null; turns: number } {
  const dated = crawl.runs.filter((run) => !Number.isNaN(Date.parse(run.at)));
  if (dated.length === 0) {
    return { first: null, last: null, turns: crawl.runs.length };
  }
  const ordered = [...dated].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return {
    first: ordered[0].at,
    last: ordered[ordered.length - 1].at,
    turns: crawl.runs.length,
  };
}
