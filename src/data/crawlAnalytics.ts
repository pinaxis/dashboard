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
