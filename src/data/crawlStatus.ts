import type { CrawlStatus } from "../../worker/github.ts";

export type LiveState =
  | { kind: "loading" }
  | { kind: "unknown"; error: string }
  | { kind: "ready"; status: CrawlStatus };

export type StatusTone = "running" | "paused" | "idle" | "unknown";

/** @remarks a lock held by a hop on another host has no run here; starting then would lift the pause. */
export function canStart(status: CrawlStatus): boolean {
  return status.current === null && !status.lock.held;
}

export function isActive(status: CrawlStatus): boolean {
  return status.current !== null || status.lock.held;
}

export function describeStatus(state: LiveState, relative: (iso: string) => string): { tone: StatusTone; text: string } {
  if (state.kind === "loading") {
    return { tone: "unknown", text: "Checking crawl status" };
  }
  if (state.kind === "unknown") {
    return { tone: "unknown", text: `Crawl status unknown: ${state.error}` };
  }
  const { current, lock, paused } = state.status;
  if (current) {
    return { tone: "running", text: `Crawl running (${current.workflow}) since ${relative(current.startedAt)}` };
  }
  if (lock.held) {
    return { tone: "running",
      text: `Crawl lock held by ${lock.holder ?? "an unnamed holder"} since ${relative(lock.since ?? "")}` };
  }
  if (paused) {
    return { tone: "paused", text: "Paused: scheduled resumes and chain hops stay stopped until a full run starts" };
  }
  return { tone: "idle", text: "No crawl running" };
}
