import { useCallback, useEffect, useState } from "react";
import type { Crawl, GraphDocument } from "../data/graph";
import { crawlApi } from "../data/crawlApi";
import type { StartInputs } from "../data/crawlApi";
import { describeStatus } from "../data/crawlStatus";
import type { LiveState } from "../data/crawlStatus";
import { compactNumber, relativeTime } from "../lib/format";
import { STATUS, SERIES } from "../lib/palette";

const POLL_MS = 15_000;

function Tile({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div className="tile">
      <span className="tile-value" style={accent ? { color: accent } : undefined}>{value}</span>
      <span className="tile-label">{label}</span>
    </div>
  );
}

function Panel({ title, wide, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={`panel ${wide ? "panel-wide" : ""}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const errorText = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

function useLiveStatus(): [LiveState, () => Promise<void>] {
  const [state, setState] = useState<LiveState>({ kind: "loading" });
  const refresh = useCallback(async () => {
    try {
      setState({ kind: "ready", status: await crawlApi.status() });
    } catch (failure) {
      setState({ kind: "unknown", error: errorText(failure) });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const running = state.kind === "ready" && state.status.current !== null;
  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      if (!window.document.hidden) {
        void refresh();
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, refresh]);
  return [state, refresh];
}

function Controls({ crawl, state, refresh }: { crawl: Crawl; state: LiveState; refresh: () => Promise<void> }) {
  const [targets, setTargets] = useState("");
  const [maxSearches, setMaxSearches] = useState("");
  const [pages, setPages] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = state.kind === "ready" ? state.status : null;

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  const inputs = (mode: StartInputs["mode"]): StartInputs => ({
    mode,
    ...(targets.trim() ? { targets: targets.trim() } : {}),
    ...(maxSearches ? { maxSearches: Number(maxSearches) } : {}),
    ...(pages ? { discoveryPages: Number(pages) } : {}),
  });
  const cancel = () => {
    if (window.confirm("Cancel the running crawl? It is paused first; work since its last snapshot is lost, "
      + "and the crawl lock clears when its lease expires.")) {
      void act(crawlApi.cancel);
    }
  };
  const cannotStart = busy || !status || status.current !== null;

  return (
    <section className="panel panel-wide controls">
      <h2>Controls</h2>
      <div className="controls-grid">
        <label>
          Targets (comma separated, blank for all)
          <input list="crawl-targets" value={targets} onChange={(event) => setTargets(event.target.value)} />
          <datalist id="crawl-targets">
            {crawl.targets.map((row) => <option key={row.target} value={row.target} />)}
          </datalist>
        </label>
        <label>
          Max searches (blank for uncapped)
          <input type="number" min={1} max={1000} value={maxSearches} onChange={(event) => setMaxSearches(event.target.value)} />
        </label>
        <label>
          Discovery pages (blank for all ten)
          <input type="number" min={1} max={10} value={pages} onChange={(event) => setPages(event.target.value)} />
        </label>
      </div>
      <div className="controls-actions">
        <button type="button" className="control-start" disabled={cannotStart} onClick={() => void act(() => crawlApi.start(inputs("full")))}>Start full crawl</button>
        <button type="button" className="control-stop" disabled={cannotStart} onClick={() => void act(() => crawlApi.start(inputs("test")))}>Start test run</button>
        <button type="button" className="control-stop" disabled={busy || !status || status.paused} onClick={() => void act(crawlApi.pause)}>Pause</button>
        <button type="button" className="control-stop" disabled={busy || !status?.current} onClick={cancel}>Cancel running crawl</button>
      </div>
      {error && <p className="progress-detail" style={{ color: STATUS.serious }}>{error}</p>}
      <p className="progress-detail">
        A full crawl is the default. A manual full run lifts a pause; a capped or test run sets the pause again
        when it starts, so the schedule does not continue it uncapped. Pause lets the current turn finish;
        cancel stops it now.
      </p>
    </section>
  );
}

export function CrawlProgress({ document }: { document: GraphDocument }) {
  const crawl = document.crawl;
  const [state, refresh] = useLiveStatus();

  if (!crawl) {
    return (
      <div className="analytics">
        <p className="empty">This dataset carries no crawl telemetry.</p>
      </div>
    );
  }

  const line = describeStatus(state, relativeTime);
  const lastRun = crawl.runs[0];
  const mostStored = Math.max(1, ...crawl.runs.map((run) => run.stored));

  return (
    <div className="analytics">
      <div className={`crawl-status crawl-status-${line.tone}`}>
        <span className="crawl-dot" />
        <span>{line.text}</span>
        {state.kind === "ready" && state.status.current && (
          <a href={state.status.current.url} target="_blank" rel="noopener noreferrer">view run</a>
        )}
      </div>

      <Controls crawl={crawl} state={state} refresh={refresh} />

      <div className="tiles">
        <Tile value={compactNumber(sum(crawl.targets.map((row) => row.pending)))} label="queued queries" accent={SERIES[3]} />
        <Tile value={compactNumber(sum(crawl.targets.map((row) => row.discovered)))} label="items found" />
        <Tile value={String(crawl.runs.length)} label={`runs on ${crawl.dataset}`} />
        <Tile value={lastRun ? relativeTime(lastRun.at) : "none"} label={lastRun ? `last run, ${lastRun.conclusion ?? "running"}` : "last run"} />
      </div>
      <div className="charts">
        <Panel title="By target" wide>
          <ul className="hbars">
            {crawl.targets.map((row) => (
              <li key={row.target}>
                <span className="hbar-label">{row.target}</span>
                <span className="hbar-value">
                  {compactNumber(row.discovered)} found · {compactNumber(row.pending)} queued
                  {row.complete && <strong style={{ color: STATUS.good }}> · done</strong>}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="By source">
          <ul className="hbars">
            {crawl.sources.map((row) => (
              <li key={row.source}>
                <span className="hbar-label">{row.source}</span>
                <span className="hbar-value">{compactNumber(row.pending)} queued</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="First seen during each run" wide>
          <ul className="hbars">
            {crawl.runs.map((run) => (
              <li key={run.url}>
                <a className="hbar-label" href={run.url} target="_blank" rel="noopener noreferrer">
                  {run.workflow} {relativeTime(run.at)}
                </a>
                <span className="hbar-track">
                  <span className="hbar-fill" style={{ width: `${(run.stored / mostStored) * 100}%`, background: SERIES[0] }} />
                </span>
                <span className="hbar-value">{compactNumber(run.stored)}</span>
              </li>
            ))}
          </ul>
          <p className="progress-detail">
            Nodes first seen between a run's start and the next run's start. An approximation: a long run can
            find nodes after a later run has started.
          </p>
        </Panel>
      </div>
    </div>
  );
}
